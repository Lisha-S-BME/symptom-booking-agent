require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Groq = require('groq-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

app.use(bodyParser.json());

// Enable CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

async function classifySymptoms(symptoms, age) {
  const prompt = `You are a clinical decision support AI for a hospital appointment system.

Patient Symptoms: "${symptoms}"
Patient Age: ${age}

Your task:
1. Identify the most appropriate medical department
2. Determine urgency: "High", "Medium", or "Low"
3. Provide a realistic doctor name (Indian/International context)
4. Provide a brief reasoning (1-2 sentences)

SAFETY RULES:
- Chest pain, breathing difficulty, severe bleeding, stroke symptoms → ALWAYS High urgency
- If uncertain → set Medium urgency and recommend human review
- Do NOT diagnose the condition. Only classify.

Respond in valid JSON only. No markdown. Format:
{
  "department": "Cardiology",
  "urgency": "High",
  "doctor": "Dr. Priya Sharma",
  "reasoning": "Patient reports chest pain radiating to left arm which requires immediate cardiac evaluation."
}`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a medical classification assistant. Always respond in valid JSON. Use realistic Indian/International doctor names. Never diagnose. If uncertain, flag for human review."
        },
        { role: "user", content: prompt }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_tokens: 300,
    });

    const response = completion.choices[0]?.message?.content;
    let cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(cleanResponse);
    
    if (!result.department || !result.urgency) {
      return {
        department: "General Medicine",
        urgency: "Medium",
        doctor: "Dr. Anjali Deshmukh",
        reasoning: "AI could not determine with confidence. Human review recommended.",
        escalated: true,
        hospital: "City General Hospital"
      };
    }

    const hospitalMap = {
      "Cardiology": "Metro Heart Institute",
      "Neurology": "Brain & Spine Center",
      "Dermatology": "Skin Care Clinic, Medical Hub",
      "Orthopedics": "Joint & Bone Hospital",
      "General Medicine": "City General Hospital",
      "ENT": "ENT Specialty Center",
      "Gastroenterology": "Digestive Health Institute",
      "Pediatrics": "Children's Medical Center",
      "Ophthalmology": "Vision Care Hospital",
      "Pulmonology": "Respiratory Care Center"
    };

    return {
      ...result,
      escalated: result.urgency === "High",
      hospital: hospitalMap[result.department] || "City General Hospital"
    };

  } catch (error) {
    console.error("Groq API Error:", error.message);
    return {
      department: "General Medicine",
      urgency: "Medium",
      doctor: "Dr. Rajesh Kumar",
      reasoning: "AI temporarily unavailable. Human review required.",
      escalated: true,
      hospital: "City General Hospital"
    };
  }
}

async function writeToFHIR(patientData) {
  try {
    const fhirBase = "https://hapi.fhir.org/baseR4";
    
    const patientResource = {
      resourceType: "Patient",
      name: [{ text: patientData.name }],
      birthDate: `${new Date().getFullYear() - parseInt(patientData.age)}-01-01`
    };

    const patientResponse = await fetch(`${fhirBase}/Patient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify(patientResource)
    });
    const createdPatient = await patientResponse.json();
    const patientId = createdPatient.id || 'unknown';

    const appointmentResource = {
      resourceType: "Appointment",
      status: "booked",
      description: `AI-Classified: ${patientData.department} | Urgency: ${patientData.urgency}`,
      start: `${patientData.date}T${patientData.time}:00`,
      created: new Date().toISOString(),
      participant: [{
        actor: { reference: `Patient/${patientId}`, display: patientData.name },
        status: "accepted"
      }],
      reasonCode: [{ text: patientData.symptoms }],
      extension: [
        { url: "https://hospital-api/urgency", valueString: patientData.urgency },
        { url: "https://hospital-api/department", valueString: patientData.department },
        { url: "https://hospital-api/doctor", valueString: patientData.doctor },
        { url: "https://hospital-api/ai-reasoning", valueString: patientData.reasoning },
        { url: "https://hospital-api/escalated", valueBoolean: patientData.escalated }
      ]
    };

    const appointmentResponse = await fetch(`${fhirBase}/Appointment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify(appointmentResource)
    });
    const createdAppointment = await appointmentResponse.json();
    
    console.log("[FHIR] Appointment written:", createdAppointment.id || 'created');
    
    return {
      patientId: patientId,
      appointmentId: createdAppointment.id || 'created',
      fhirUrl: `${fhirBase}/Appointment/${createdAppointment.id || ''}`
    };

  } catch (error) {
    console.error("[FHIR] Write failed:", error.message);
    return {
      patientId: 'offline',
      appointmentId: 'offline',
      fhirUrl: 'FHIR offline - data saved locally'
    };
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/classify', async (req, res) => {
  try {
    const { symptoms, age } = req.body;
    
    if (!symptoms || !age) {
      return res.status(400).json({ error: "Symptoms and age are required" });
    }
    
    const result = await classifySymptoms(symptoms, age);
    res.json(result);
    
  } catch (error) {
    console.error("API Error:", error.message);
    res.status(500).json({ error: "Classification failed" });
  }
});

app.post('/submit', async (req, res) => {
  try {
    const { name, age, symptoms, date, time } = req.body;

    if (!name || !age || !symptoms || !date || !time) {
      return res.status(400).send(`
        <h3 style="color:red;">Missing Required Fields</h3>
        <p>Please fill all required fields: Name, Age, Symptoms, Date, and Time.</p>
        <a href="/">Go Back</a>
      `);
    }

    const aiResult = await classifySymptoms(symptoms, age);

    let accessToken = "Token generation failed";
    try {
      const tokenResponse = await axios.post(
        `${process.env.AUTH0_ISSUER}/oauth/token`,
        {
          client_id: process.env.AUTH0_CLIENT_ID,
          client_secret: process.env.AUTH0_CLIENT_SECRET,
          audience: "https://hospital-api",
          grant_type: "client_credentials"
        },
        { headers: { 'Content-Type': 'application/json' } }
      );
      accessToken = tokenResponse.data.access_token;
      console.log("[TokenVault] Token generated successfully");
    } catch (tokenError) {
      console.error("Auth0 Token Error:", tokenError.message);
    }

    const patientsFile = path.join(__dirname, 'patients.json');
    let patients = [];

    if (fs.existsSync(patientsFile)) {
      patients = JSON.parse(fs.readFileSync(patientsFile, 'utf8'));
    }

    const refNumber = 'APT-' + Date.now().toString().slice(-8) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();

    const newPatient = {
      ref: refNumber,
      name,
      age,
      symptoms,
      department: aiResult.department,
      doctor: aiResult.doctor,
      hospital: aiResult.hospital,
      urgency: aiResult.urgency,
      reasoning: aiResult.reasoning,
      escalated: aiResult.escalated,
      date,
      time,
      token: accessToken.slice(0, 30) + '...',
      timestamp: new Date().toISOString()
    };

    patients.push(newPatient);
    fs.writeFileSync(patientsFile, JSON.stringify(patients, null, 2));

    const fhirResult = await writeToFHIR(newPatient);
    console.log("[FHIR] Status:", fhirResult.fhirUrl);

    res.send(`
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Arial, sans-serif; background: linear-gradient(135deg, #eff6ff, #f0fdf4); min-height: 100vh; padding: 30px 20px; }
          .slip { max-width: 500px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
          .slip-header { background: #1e40af; color: white; padding: 24px; text-align: center; }
          .slip-header h2 { font-size: 20px; margin-bottom: 4px; }
          .slip-header .ref { font-size: 12px; opacity: 0.85; letter-spacing: 1px; }
          .slip-body { padding: 24px; }
          .row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f1f5f9; }
          .row:last-child { border-bottom: none; }
          .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
          .value { font-size: 15px; font-weight: 500; color: #1e293b; text-align: right; }
          .badge { display: inline-block; padding: 5px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; }
          .badge-high { background: #fef2f2; color: #dc2626; }
          .badge-medium { background: #fffbeb; color: #d97706; }
          .badge-low { background: #eff6ff; color: #2563eb; }
          .reasoning-box { background: #f8fafc; border-left: 3px solid #2563eb; padding: 12px 16px; margin: 16px 0; border-radius: 0 8px 8px 0; font-size: 13px; color: #475569; font-style: italic; }
          .escalated { background: #fef2f2; color: #dc2626; padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; text-align: center; margin-bottom: 16px; }
          .slip-footer { padding: 20px 24px; background: #f8fafc; text-align: center; display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
          .btn { padding: 10px 20px; border-radius: 8px; font-weight: 600; text-decoration: none; font-size: 14px; display: inline-block; }
          .btn-primary { background: #2563eb; color: white; }
          .btn-outline { border: 2px solid #2563eb; color: #2563eb; background: white; }
        </style>
      </head>
      <body>
        <div class="slip">
          <div class="slip-header">
            <h2>Appointment Confirmed</h2>
            <div class="ref">Ref: ${refNumber}</div>
          </div>
          <div class="slip-body">
            ${aiResult.escalated ? '<div class="escalated">Flagged for Clinician Review</div>' : ''}
            <div class="row"><span class="label">Patient</span><span class="value">${name}, Age ${age}</span></div>
            <div class="row"><span class="label">Hospital</span><span class="value">${aiResult.hospital || 'City General Hospital'}</span></div>
            <div class="row"><span class="label">Department</span><span class="value">${aiResult.department}</span></div>
            <div class="row"><span class="label">Doctor</span><span class="value">${aiResult.doctor}, MD</span></div>
            <div class="row"><span class="label">Urgency</span><span class="value"><span class="badge ${aiResult.urgency === 'High' ? 'badge-high' : aiResult.urgency === 'Medium' ? 'badge-medium' : 'badge-low'}">${aiResult.urgency}</span></span></div>
            <div class="row"><span class="label">Date & Time</span><span class="value">${date} at ${time}</span></div>
            <div class="reasoning-box">AI Reasoning: "${aiResult.reasoning}"</div>
            <div class="row" style="font-size:11px; color:#94a3b8;"><span>Auth0 Token Vault | FHIR ID: ${fhirResult.appointmentId || 'offline'}</span></div>
          </div>
          <div class="slip-footer">
            <a href="/" class="btn btn-primary">Book Another</a>
            <a href="/patients" class="btn btn-outline">View All Records</a>
          </div>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error("Server Error:", error.message);
    res.status(500).send(`<h3 style="color:red;">Something went wrong</h3><p>${error.message}</p><a href="/">Go Back</a>`);
  }
});

app.get('/patients', (req, res) => {
  const patientsFile = path.join(__dirname, 'patients.json');

  if (!fs.existsSync(patientsFile)) {
    return res.send("<h2>No records found</h2><a href='/'>Back</a>");
  }

  const patients = JSON.parse(fs.readFileSync(patientsFile, 'utf8'));

  let html = `
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; margin: 30px; background: #f8fafc; }
        h2 { color: #1e40af; }
        table { border-collapse: collapse; width: 100%; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
        th { background: #1e40af; color: white; padding: 12px 10px; font-size: 13px; text-align: left; }
        td { padding: 10px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
        tr:hover { background: #f0fdf4; }
        .high { color: #dc2626; font-weight: bold; }
        .medium { color: #d97706; font-weight: bold; }
        .low { color: #2563eb; }
        .escalated { background: #fefce8; }
        .ref { font-family: monospace; font-size: 11px; color: #64748b; }
        a { color: #2563eb; text-decoration: none; font-weight: 600; }
      </style>
    </head>
    <body>
      <h2>Patient Records</h2>
      <table>
        <tr><th>Ref</th><th>Name</th><th>Age</th><th>Symptoms</th><th>Department</th><th>Doctor</th><th>Hospital</th><th>Urgency</th><th>Escalated</th><th>Date</th></tr>
  `;

  patients.forEach(p => {
    const urgencyClass = (p.urgency || '').toLowerCase();
    const rowClass = p.escalated ? 'escalated' : '';
    html += `
      <tr class="${rowClass}">
        <td class="ref">${p.ref || '-'}</td>
        <td>${p.name}</td>
        <td style="color: ${parseInt(p.age) >= 60 ? '#dc2626' : '#111827'}; font-weight: ${parseInt(p.age) >= 60 ? 'bold' : 'normal'};">${p.age}</td>
        <td>${p.symptoms}</td>
        <td>${p.department}</td>
        <td>${p.doctor}</td>
        <td>${p.hospital || '-'}</td>
        <td class="${urgencyClass}">${p.urgency}</td>
        <td>${p.escalated ? 'Yes' : 'No'}</td>
        <td>${p.date}</td>
      </tr>
    `;
  });

  html += `</table><br><a href='/'>Back to Booking</a> | <button onclick="clearRecords()" style="background:#dc2626; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:600;">Clear All Records</button><script>async function clearRecords(){if(confirm('Delete all patient records?')){await fetch('/clear',{method:'POST'});window.location.reload();}}</script></body></html>`;
  
  res.send(html);
});

app.post('/clear', (req, res) => {
  const patientsFile = path.join(__dirname, 'patients.json');
  fs.writeFileSync(patientsFile, '[]');
  res.redirect('/patients');
});

app.listen(PORT, () => {
  console.log(`Server running on ${process.env.BASE_URL || 'http://localhost:' + PORT}`);
  console.log(`AI Classification: Groq (llama-3.3-70b-versatile)`);
  console.log(`Auth0 Token Vault: Connected`);
  console.log(`FHIR Sandbox: https://hapi.fhir.org/baseR4`);
  console.log(`API Endpoint: /api/classify ready`);
});