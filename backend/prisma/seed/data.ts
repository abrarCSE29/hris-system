import type { Country } from "../../src/generated/prisma/client";

/** Local dev password for every seeded account. Override with SEED_PASSWORD (required for deployed seeding). */
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "Password123!";
export const EMAIL_DOMAIN = "hris.test";

export const COUNTRY_COUNTS: Record<Country, number> = {
  BANGLADESH: 40,
  MALAYSIA: 25,
  SRI_LANKA: 20,
  CYPRUS: 15,
};

export const NAMES: Record<Country, { first: string[]; last: string[] }> = {
  BANGLADESH: {
    first: ["Rahim", "Karim", "Nusrat", "Farhana", "Tanvir", "Sabbir", "Mehedi", "Shirin", "Tasnim", "Imran", "Arif", "Sumaiya", "Rafiq", "Jannat", "Nafisa", "Hasan", "Mahmud", "Rumana", "Shakil", "Anika", "Zahid", "Mitu", "Fahim", "Sadia", "Rashed", "Lamia", "Nayeem", "Tahmina", "Ashik", "Maliha"],
    last: ["Hossain", "Ahmed", "Rahman", "Chowdhury", "Islam", "Khan", "Uddin", "Akter", "Begum", "Siddique", "Sarker", "Mia", "Talukder", "Haque", "Majumder", "Biswas", "Das", "Roy", "Sultana", "Karim"],
  },
  MALAYSIA: {
    first: ["Aiman", "Nurul", "Farid", "Siti", "Haziq", "Aisyah", "Weijie", "Mei Ling", "Jun Hao", "Priya", "Arjun", "Kavitha", "Hafiz", "Syafiqah", "Daniel", "Shu Ting", "Ravi", "Devi", "Irfan", "Zulaikha"],
    last: ["Abdullah", "Ismail", "Tan", "Lim", "Lee", "Wong", "Chong", "Rahman", "Yusof", "Hassan", "Nair", "Pillai", "Krishnan", "Rajan", "Ibrahim", "Ong", "Teoh", "Chan", "Samy", "Hamid"],
  },
  SRI_LANKA: {
    first: ["Kasun", "Nimali", "Dilshan", "Sanduni", "Tharindu", "Chamari", "Ruwan", "Ishara", "Lakmal", "Thilini", "Nuwan", "Hasini", "Pradeep", "Anjali", "Suresh", "Kavindi", "Janaka", "Dinesh", "Menaka", "Sarath"],
    last: ["Perera", "Fernando", "Silva", "Jayasinghe", "Wickramasinghe", "Gunawardena", "Rajapaksa", "De Silva", "Bandara", "Senanayake", "Karunaratne", "Weerasinghe", "Dissanayake", "Herath", "Samarasinghe", "Ratnayake", "Kumar", "Selvarajah", "Pathirana", "Amarasinghe"],
  },
  CYPRUS: {
    first: ["Andreas", "Maria", "Georgios", "Eleni", "Christos", "Elena", "Nikolas", "Sophia", "Marios", "Despina", "Costas", "Anna", "Panayiotis", "Christina", "Michalis", "Irene", "Stavros", "Katerina", "Loukas", "Evi"],
    last: ["Georgiou", "Christodoulou", "Charalambous", "Constantinou", "Ioannou", "Papadopoulos", "Michael", "Demetriou", "Savva", "Andreou", "Nicolaou", "Kyriacou", "Antoniou", "Pavlou", "Stylianou", "Hadjipanayi", "Mavrides", "Kouros", "Petrou", "Zachariou"],
  },
};

export interface DepartmentPlan {
  code: string;
  name: string;
  headTitle: string;
  managerTitle: string;
  /** Extra (non-head) managers. */
  managers: number;
  /** HR Admins live in People & Culture only. */
  hrAdmins: number;
  employees: number;
  employeeTitles: string[];
}

// Totals: 100 people, 12 managers (7 heads + 5), 3 HR admins, 85 employees.
export const DEPARTMENTS: DepartmentPlan[] = [
  { code: "ENG", name: "Engineering", headTitle: "Head of Engineering", managerTitle: "Engineering Manager", managers: 2, hrAdmins: 0, employees: 27, employeeTitles: ["Software Engineer", "Senior Software Engineer", "Frontend Engineer", "Backend Engineer", "QA Engineer", "DevOps Engineer", "Data Engineer"] },
  { code: "ITOPS", name: "IT Operations", headTitle: "Head of IT Operations", managerTitle: "IT Operations Manager", managers: 0, hrAdmins: 0, employees: 11, employeeTitles: ["IT Support Specialist", "Systems Administrator", "Network Engineer", "Security Analyst"] },
  { code: "PEOPLE", name: "People & Culture", headTitle: "Head of People & Culture", managerTitle: "People Manager", managers: 0, hrAdmins: 3, employees: 6, employeeTitles: ["HR Business Partner", "Recruiter", "Payroll Specialist", "Learning & Development Specialist"] },
  { code: "FIN", name: "Finance", headTitle: "Head of Finance", managerTitle: "Finance Manager", managers: 1, hrAdmins: 0, employees: 8, employeeTitles: ["Accountant", "Financial Analyst", "Accounts Payable Officer", "Treasury Analyst"] },
  { code: "MKT", name: "Marketing", headTitle: "Head of Marketing", managerTitle: "Marketing Manager", managers: 1, hrAdmins: 0, employees: 12, employeeTitles: ["Digital Marketing Specialist", "Content Strategist", "Brand Designer", "SEO Analyst"] },
  { code: "LEGAL", name: "Legal & Compliance", headTitle: "Head of Legal & Compliance", managerTitle: "Compliance Manager", managers: 0, hrAdmins: 0, employees: 5, employeeTitles: ["Legal Counsel", "Compliance Officer", "Contracts Specialist"] },
  { code: "OPS", name: "Operations", headTitle: "Head of Operations", managerTitle: "Operations Manager", managers: 1, hrAdmins: 0, employees: 16, employeeTitles: ["Operations Coordinator", "Facilities Officer", "Office Administrator", "Procurement Officer"] },
];

// Request categories and the department that handles each (spec §3.3).
export const CATEGORIES = [
  { code: "IT_EQUIPMENT", name: "IT Equipment", department: "ITOPS" },
  { code: "SOFTWARE_ACCESS", name: "Software Access", department: "ITOPS" },
  { code: "HR_QUERY", name: "HR Query", department: "PEOPLE" },
  { code: "FACILITIES", name: "Facilities", department: "OPS" },
  { code: "OTHER", name: "Other", department: "PEOPLE" },
] as const;

/**
 * The 7 designated new hires (T17 onboards them): country, plus the department we would like them in.
 * The first one is the demo "new hire" login and must be in Engineering (it reports to the demo manager).
 * If nobody matches the preferred department in that country, any eligible employee is used.
 */
export const NEW_HIRES: { country: Country; department: string }[] = [
  { country: "BANGLADESH", department: "ENG" },
  { country: "BANGLADESH", department: "MKT" },
  { country: "BANGLADESH", department: "OPS" },
  { country: "MALAYSIA", department: "FIN" },
  { country: "MALAYSIA", department: "MKT" },
  { country: "SRI_LANKA", department: "OPS" },
  { country: "CYPRUS", department: "LEGAL" },
];

export const PERSONA_EMAILS = {
  hrAdmin: `hr.admin@${EMAIL_DOMAIN}`,
  manager: `manager@${EMAIL_DOMAIN}`,
  newHire: `new.hire@${EMAIL_DOMAIN}`,
  itSupport: `it.support@${EMAIL_DOMAIN}`,
} as const;
