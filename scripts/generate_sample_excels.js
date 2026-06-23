const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Ensure output directory exists in workspace
const outputDir = path.resolve(__dirname, '../sample-excel-sheets');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

console.log("Generating high-volume sample data sheets...");

// Realistic sample components
const firstNames = ["Aung", "Kyaw", "Zaw", "Min", "Thura", "Hein", "Ye", "Soe", "Nyan", "Htet", "Myo", "Tun", "Wai", "Phyo", "Kaung", "Ko", "Maung"];
const lastNames = ["Min", "Zaw", "Thu", "Naing", "Lwin", "Aung", "Htwe", "Oo", "Khant", "Kyaw", "Hlaing", "Lin", "Htoo", "Shein", "Phyo", "Swe"];
const femaleNames = ["Daw Hla Hla", "Ma Su Mon", "Nandar Htwe", "Thiri Win", "Ei Mon", "Yamin Oo", "Htet Htet", "Daw Khin Lay", "Ma Phyu Phyu", "Wint Wah"];
const companyTypes = ["Trading", "Retail", "Clinic", "Logistics", "Travel", "F&B", "Salon", "Electronics", "Construction", "Supply Chain"];
const locations = ["Yangon", "Mandalay", "Naypyitaw", "Taunggyi", "Mawlamyine"];

function getMyanmarName(index) {
  if (index % 3 === 0) {
    return femaleNames[index % femaleNames.length];
  }
  const f = firstNames[index % firstNames.length];
  const l = lastNames[(index * 7) % lastNames.length];
  return `${f} ${l}`;
}

function getCompanyName(name, index) {
  const type = companyTypes[index % companyTypes.length];
  const loc = locations[index % locations.length];
  return `${name.split(' ').pop()} ${type} (${loc})`;
}

function getMyanmarPhone(index) {
  const prefix = ["09950", "09421", "09770", "09250", "09988", "09789"][index % 6];
  const suffix = String(100000 + (index * 13579) % 900000);
  return prefix + suffix;
}

function getEmail(name) {
  const clean = name.toLowerCase().replace(/[^a-z]/g, "");
  return `${clean}@gmail.com`;
}

// ─── 1. Sales & Marketing Demand Leads (50 Rows) ───
const salesData = [];
const services = [
  { name: "Gold Package", amount: 1500000 },
  { name: "Silver Package", amount: 980000 },
  { name: "CRM Setup", amount: 2100000 },
  { name: "Website Care", amount: 950000 },
  { name: "AI Automation", amount: 3200000 },
  { name: "Social Media Management", amount: 450000 },
  { name: "Lead Capture Form", amount: 350000 }
];
const channels = ["Facebook", "Telegram", "Google", "Referral", "Walk-in"];
const campaigns = ["June Launch", "Beauty Owners", "Partner Referral", "Search High Intent", "Automation Webinar", "Retargeting"];
const stages = ["new", "contacted", "quoted", "pending", "closed"];
const priorities = ["high", "medium", "low"];

for (let i = 1; i <= 50; i++) {
  const dateObj = new Date(2026, 5, Math.max(1, i % 23)); // June 2026 (restricted up to June 23)
  const dateStr = dateObj.toISOString().slice(0, 10);
  
  const clientName = getMyanmarName(i);
  const company = getCompanyName(clientName, i);
  const phone = getMyanmarPhone(i);
  const svc = services[i % services.length];
  
  const followUpObj = new Date(dateObj);
  followUpObj.setDate(dateObj.getDate() + (i % 6) + 3);
  const followUpStr = followUpObj.toISOString().slice(0, 10);
  
  salesData.push({
    date: dateStr,
    customer_name: clientName,
    phone: phone,
    company: company,
    service_name: svc.name,
    service_amount: svc.amount,
    service_qty: (i % 4) === 0 ? 2 : 1,
    source_channel: channels[i % channels.length],
    campaign: campaigns[i % campaigns.length],
    lead_stage: stages[i % stages.length],
    priority: priorities[i % priorities.length],
    follow_up_date: followUpStr,
    note: `Lead collected for ${svc.name}. Interested in customized dashboard integrations. Refer ID: ${i}`
  });
}

// ─── 2. Finance Income & Expense (50 Rows) ───
const financeData = [];
const paymentMethods = ["KBZ Pay", "Wave Money", "Bank Transfer", "Card", "Cash"];
const expenseDescriptions = [
  { desc: "Facebook lead campaign", cat: "Marketing", method: "Wave Money" },
  { desc: "Google search ads", cat: "Marketing", method: "Card" },
  { desc: "AWS hosting renewal", cat: "Infrastructure", method: "Card" },
  { desc: "Office supplies and stationery", cat: "Admin", method: "Cash" },
  { desc: "Software subscription renewal", cat: "Software", method: "Card" },
  { desc: "Facebook ad spend re-boost", cat: "Marketing", method: "Card" },
  { desc: "Team payroll advance", cat: "Payroll", method: "Bank Transfer" },
  { desc: "Domain renewal Namecheap", cat: "Infrastructure", method: "Card" },
  { desc: "Office rent payment", cat: "Admin", method: "Bank Transfer" },
  { desc: "Internet bills broadband", cat: "Admin", method: "Cash" }
];

for (let i = 1; i <= 50; i++) {
  const dateObj = new Date(2026, 5, Math.max(1, i % 23)); // June 2026 (restricted up to June 23)
  const dateStr = dateObj.toISOString().slice(0, 10);
  const isIncome = i % 2 === 0;
  
  if (isIncome) {
    const clientName = getMyanmarName(i + 10);
    const svc = services[i % services.length];
    financeData.push({
      date: dateStr,
      description: `${svc.name} payment`,
      category: "Service",
      type: "Income",
      amount_mmk: svc.amount * ((i % 3) === 0 ? 2 : 1),
      payment_method: paymentMethods[i % paymentMethods.length],
      reference: `INV-2026-${1000 + i}`,
      notes: `customer: ${clientName}; service: ${svc.name}`
    });
  } else {
    const exp = expenseDescriptions[i % expenseDescriptions.length];
    const amount = Math.floor(50000 + (i * 24357) % 800000);
    financeData.push({
      date: dateStr,
      description: exp.desc,
      category: exp.cat,
      type: "Expense",
      amount_mmk: amount,
      payment_method: exp.method,
      reference: `EXP-2026-${2000 + i}`,
      notes: `Ops utility record. code: OPS-${i}`
    });
  }
}

// ─── 3. Projects & Infrastructure Expiry (30 Rows) ───
const projectData = [];
const domainProviders = ["Namecheap", "GoDaddy", "Cloudflare", "Hostinger"];
const hostingProviders = ["AWS", "DigitalOcean", "Vercel", "Hostinger", "Google Cloud"];

for (let i = 1; i <= 30; i++) {
  const clientName = getMyanmarName(i * 2);
  const company = getCompanyName(clientName, i * 2);
  const cleanComp = company.split(' ')[0].toLowerCase();
  
  const domDate = new Date(2026, 5 + (i % 6), Math.max(1, (i * 3) % 28)); // June - Nov 2026
  const hostDate = new Date(domDate);
  hostDate.setDate(domDate.getDate() + (i % 10) - 5);
  
  projectData.push({
    project_name: `${company.split(' ')[0]} Business Portal`,
    url: `${cleanComp}-app.com`,
    domain_provider: domainProviders[i % domainProviders.length],
    domain_expire_date: domDate.toISOString().slice(0, 10),
    hosting_provider: hostingProviders[i % hostingProviders.length],
    hosting_expire_date: hostDate.toISOString().slice(0, 10),
    package_name: services[i % services.length].name,
    owner: clientName,
    priority: i % 4 === 0 ? "urgent" : (i % 3 === 0 ? "high" : "medium"),
    remark: `Customer contacts verified. No pending bills for this infrastructure instance.`
  });
}

// ─── 4. Website Updates Status (30 Rows) ───
const updateData = [];
const businessTypes = ["Retail", "Healthcare", "Travel", "Enterprise", "Fashion", "Wholesale", "Logistics", "Education"];
const updateStatuses = ["up_to_date", "pending_update", "in_progress"];
const changes = [
  "add June revenue widgets",
  "appointment reminder text update",
  "replace tour package photos",
  "workflow dashboard check",
  "new arrivals section addition",
  "monthly supplier report setup",
  "add township dropdown in contact page",
  "admission FAQ update in bot"
];

for (let i = 1; i <= 30; i++) {
  const clientName = getMyanmarName(i + 3);
  const company = getCompanyName(clientName, i + 3);
  const cleanComp = company.split(' ')[0].toLowerCase();
  
  const updateDate = new Date(2026, 5, Math.max(1, i % 23));
  
  updateData.push({
    name: `${company.split(' ')[0]} Storefront`,
    url: `${cleanComp}-store.com`,
    business_type: businessTypes[i % businessTypes.length],
    package_name: services[i % services.length].name,
    status: updateStatuses[i % updateStatuses.length],
    last_update_date: updateDate.toISOString().slice(0, 10),
    requested_change: changes[i % changes.length],
    remark: `Requested by owner ${clientName}. Support ticket link verified.`
  });
}

// ─── 5. Purchased Customer Directory (30 Rows) ───
const csDirData = [];

for (let i = 1; i <= 30; i++) {
  const clientName = getMyanmarName(i + 5);
  const company = getCompanyName(clientName, i + 5);
  const phone = getMyanmarPhone(i + 5);
  const svc = services[i % services.length];
  
  const purchaseDate = new Date(2026, 5, Math.max(1, i % 23));
  const followUpDate = new Date(purchaseDate);
  followUpDate.setDate(purchaseDate.getDate() + 15);
  
  csDirData.push({
    customer_name: clientName,
    company: company,
    phone: phone,
    email: getEmail(clientName),
    purchased_service: svc.name,
    purchase_amount_mmk: svc.amount,
    purchase_date: purchaseDate.toISOString().slice(0, 10),
    status: i % 10 === 0 ? "inactive" : "active",
    next_follow_up: followUpDate.toISOString().slice(0, 10),
    csat: (i % 5 === 0) ? 3 : ((i % 3 === 0) ? 4 : 5),
    last_contact_note: `Client onboarding successful. Package active: ${svc.name}. Remarks logged.`
  });
}

// ─── 6. Daily Business Summary Report (30 Rows) ───
const dailyReportData = [];
for (let i = 1; i <= 23; i++) {
  const dateObj = new Date(2026, 5, i); // June 1 to 23, 2026
  const dateStr = dateObj.toISOString().slice(0, 10);
  
  const budget = i % 3 === 0 ? Math.floor(100000 + (i * 12345) % 200000) : 0;
  const sales = i % 2 === 0 ? Math.floor(300000 + (i * 45678) % 1500000) : 0;
  const calls = Math.floor(15 + (i * 7) % 25);
  const appts = Math.floor(5 + (i * 3) % 10);
  const kept = Math.max(1, appts - (i % 3));
  const leads = Math.floor(4 + (i * 9) % 12);
  const closed = i % 2 === 0 ? Math.max(1, Math.floor(kept / 2)) : 0;
  
  dailyReportData.push({
    "Date": dateStr,
    "Marketing Budget": budget,
    "Channel": ["Facebook", "Google", "Referral", "Walk-in", "Telegram"][i % 5],
    "Calls Made": calls,
    "Appointments Made": appts,
    "Appointments Kept": kept,
    "New Leads": leads,
    "Total Demand": leads + 2,
    "Total Sales": sales,
    "Closed Deals": closed,
    "Pending Deals": Math.max(0, appts - closed),
    "Notes": `Daily summary for ${dateStr}. Marketing ROI is positive.`
  });
}

// Write to files
const fileDefinitions = [
  { data: salesData, name: 'Sales_Marketing_Demand_Leads.xlsx' },
  { data: financeData, name: 'Finance_Income_Expense_Report.xlsx' },
  { data: projectData, name: 'Projects_Infra_Expiry_Check.xlsx' },
  { data: updateData, name: 'Website_Updates_Status.xlsx' },
  { data: csDirData, name: 'Customer_Service_Directory.xlsx' },
  { data: dailyReportData, name: 'Daily_Business_Summary_Report.xlsx' }
];

fileDefinitions.forEach(({ data, name }) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const outputPath = path.resolve(outputDir, name);
  XLSX.writeFile(wb, outputPath);
  console.log(`Generated Excel sheet: ${outputPath} (${data.length} rows)`);
});

console.log("All sheets generated successfully!");
