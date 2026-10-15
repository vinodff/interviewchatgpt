export interface Company {
  name: string;
  category: "Product" | "Service" | "Startup" | "Other";
  aliases: string[];
  /** What this company's interviews emphasize — used to tailor answers. */
  focus: string;
}

export const COMPANIES: Company[] = [
  // Top product-based (FAANG+)
  { name: "Amazon", category: "Product", aliases: ["aws", "amazon web services"], focus: "Leadership Principles (ownership, customer obsession), DSA + system design with tradeoffs" },
  { name: "Meta", category: "Product", aliases: ["facebook", "instagram", "whatsapp"], focus: "Signal-based rounds: coding speed, system design, behavioral with impact and collaboration" },
  { name: "Google", category: "Product", aliases: ["alphabet", "youtube"], focus: "Deep DSA, Googliness, structured problem solving with complexity analysis" },
  { name: "Microsoft", category: "Product", aliases: ["azure"], focus: "Coding + design with growth mindset, collaboration and customer focus" },
  { name: "Apple", category: "Product", aliases: [], focus: "Depth in fundamentals, attention to detail, cross-functional collaboration" },
  { name: "Netflix", category: "Product", aliases: [], focus: "Freedom and responsibility, high ownership, concise senior-level communication" },
  { name: "Uber", category: "Product", aliases: [], focus: "Scale and reliability, real-world tradeoffs, moving fast with safety" },
  { name: "Airbnb", category: "Product", aliases: [], focus: "Belonging and craft, product sense with technical depth" },
  { name: "Flipkart", category: "Product", aliases: [], focus: "Scale for Indian e-commerce, DSA + HLD/LLD with practical tradeoffs" },
  { name: "Swiggy", category: "Product", aliases: [], focus: "High-throughput systems, ownership, fast execution" },
  { name: "Zomato", category: "Product", aliases: [], focus: "Scale and reliability, practical problem solving" },
  { name: "PhonePe", category: "Product", aliases: [], focus: "Payments scale and correctness, DSA + design" },
  { name: "Razorpay", category: "Product", aliases: [], focus: "Fintech correctness, API design, reliability" },
  { name: "CRED", category: "Startup", aliases: [], focus: "Craft and speed, product-minded engineering" },
  { name: "Zepto", category: "Startup", aliases: [], focus: "Speed of execution, ownership, quick commerce scale" },
  { name: "Lumen", category: "Product", aliases: ["lumen technologies", "centurylink"], focus: "Networking and telecom systems, practical engineering with reliability focus" },
  { name: "Oracle", category: "Product", aliases: [], focus: "Databases and enterprise systems, depth in fundamentals" },
  { name: "Salesforce", category: "Product", aliases: [], focus: "Trust and customer success, scalable cloud design" },
  { name: "Adobe", category: "Product", aliases: [], focus: "Craft, creativity tools, solid CS fundamentals" },
  { name: "Nvidia", category: "Product", aliases: [], focus: "Systems and performance, parallel computing depth" },
  // Indian IT services
  { name: "TCS", category: "Service", aliases: ["tata consultancy services", "tcs ninja", "tcs nqt"], focus: "Ninja/NQT pattern: aptitude + coding fundamentals, clear communication, project experience" },
  { name: "Wipro", category: "Service", aliases: ["wipro nlth", "project engineer"], focus: "NLTH pattern: fundamentals, OOPs, DBMS, ready-to-deploy attitude" },
  { name: "Infosys", category: "Service", aliases: ["infosys sp", "system engineer"], focus: "SP/DSE pattern: problem solving, OOPs, SQL, learning agility" },
  { name: "HCLTech", category: "Service", aliases: ["hcl"], focus: "Practical coding, CS fundamentals, client delivery mindset" },
  { name: "Tech Mahindra", category: "Service", aliases: [], focus: "Telecom and enterprise projects, fundamentals with communication" },
  { name: "Cognizant", category: "Service", aliases: ["cts"], focus: "GenC pattern: coding, SQL, cloud basics, communication" },
  { name: "Accenture", category: "Service", aliases: [], focus: "Versatility across stacks, agile delivery, client outcomes" },
  { name: "Capgemini", category: "Service", aliases: [], focus: "Engineering fundamentals, cloud and data basics" },
  { name: "Deloitte", category: "Service", aliases: [], focus: "Consulting mindset: structured thinking plus technical depth" },
  // Other common targets
  { name: "Startup", category: "Startup", aliases: ["early stage", "stealth"], focus: "Breadth and ownership, shipping fast with limited resources" },
  { name: "Other", category: "Other", aliases: ["general"], focus: "Balanced fundamentals with clear communication" },
];

export const ROLES: string[] = [
  "Software Engineer",
  "Senior Software Engineer",
  "SDE I",
  "SDE II",
  "SDE III",
  "Frontend Developer",
  "Backend Developer",
  "Full Stack Developer",
  "Mobile Developer (Android/iOS)",
  "Data Scientist",
  "ML Engineer",
  "Data Engineer",
  "DevOps Engineer",
  "SDET / QA Engineer",
  "System Administrator",
  "Network Engineer",
  "Support Engineer",
  "Business Analyst",
  "Product Manager",
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function searchCompanies(query: string, limit = 8): Company[] {
  const q = normalize(query);
  if (!q) return COMPANIES.slice(0, limit);
  const scored = COMPANIES.map(company => {
    const name = company.name.toLowerCase();
    let score = -1;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (company.aliases.some(alias => alias.includes(q))) score = 3;
    else if (company.category.toLowerCase().includes(q)) score = 4;
    return { company, score };
  }).filter(item => item.score >= 0);
  scored.sort((a, b) => a.score - b.score || a.company.name.localeCompare(b.company.name));
  return scored.slice(0, limit).map(item => item.company);
}

export function findCompany(name: string): Company | null {
  const q = normalize(name);
  if (!q) return null;
  return COMPANIES.find(c => c.name.toLowerCase() === q || c.aliases.some(a => a.toLowerCase() === q)) || null;
}

/** Short tailoring line for prompts and offline answers. */
export function companyContext(companyName: string, role: string): string {
  const company = findCompany(companyName);
  const who = role ? ` for a ${role}` : "";
  if (!company) {
    return companyName
      ? `Target company: ${companyName}${who}. Tune depth and examples to that company's known interview bar.`
      : `No target company selected${who}. Keep answers broadly applicable.`;
  }
  if (company.name === "Other") return `No specific target company${who}. Keep answers broadly applicable.`;
  return `Target company: ${company.name} (${company.category})${who}. Interview focus: ${company.focus}.`;
}
