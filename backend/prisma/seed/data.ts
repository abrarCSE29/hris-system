/** The four countries, by their two-letter shortcode (the seed refers to rows of the `countries` table by shortcode, never by id). */
export type Shortcode = "BD" | "MY" | "LK" | "CY";

/** The rows of the three lookup tables. The migration creates them; the seed makes sure they exist, so a database without them still seeds. */
export const ROLE_ROWS = [["EMPLOYEE", "Employee"], ["MANAGER", "Manager"], ["HR_ADMIN", "HR Admin"]] as const;
export const COUNTRY_ROWS: readonly (readonly [Shortcode, string])[] = [["BD", "Bangladesh"], ["MY", "Malaysia"], ["LK", "Sri Lanka"], ["CY", "Cyprus"]];
export const STATUS_ROWS = [["ACTIVE", "Active"], ["ON_PROBATION", "On probation"], ["ON_NOTICE", "On notice"]] as const;

/** Local dev password for every seeded account. Override with SEED_PASSWORD (required for deployed seeding). */
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "Password123!";
export const EMAIL_DOMAIN = "hris.test";

export const COUNTRY_COUNTS: Record<Shortcode, number> = {
  BD: 40,
  MY: 25,
  LK: 20,
  CY: 15,
};

export const NAMES: Record<Shortcode, { first: string[]; last: string[] }> = {
  BD: {
    first: ["Rahim", "Karim", "Nusrat", "Farhana", "Tanvir", "Sabbir", "Mehedi", "Shirin", "Tasnim", "Imran", "Arif", "Sumaiya", "Rafiq", "Jannat", "Nafisa", "Hasan", "Mahmud", "Rumana", "Shakil", "Anika", "Zahid", "Mitu", "Fahim", "Sadia", "Rashed", "Lamia", "Nayeem", "Tahmina", "Ashik", "Maliha"],
    last: ["Hossain", "Ahmed", "Rahman", "Chowdhury", "Islam", "Khan", "Uddin", "Akter", "Begum", "Siddique", "Sarker", "Mia", "Talukder", "Haque", "Majumder", "Biswas", "Das", "Roy", "Sultana", "Karim"],
  },
  MY: {
    first: ["Aiman", "Nurul", "Farid", "Siti", "Haziq", "Aisyah", "Weijie", "Mei Ling", "Jun Hao", "Priya", "Arjun", "Kavitha", "Hafiz", "Syafiqah", "Daniel", "Shu Ting", "Ravi", "Devi", "Irfan", "Zulaikha"],
    last: ["Abdullah", "Ismail", "Tan", "Lim", "Lee", "Wong", "Chong", "Rahman", "Yusof", "Hassan", "Nair", "Pillai", "Krishnan", "Rajan", "Ibrahim", "Ong", "Teoh", "Chan", "Samy", "Hamid"],
  },
  LK: {
    first: ["Kasun", "Nimali", "Dilshan", "Sanduni", "Tharindu", "Chamari", "Ruwan", "Ishara", "Lakmal", "Thilini", "Nuwan", "Hasini", "Pradeep", "Anjali", "Suresh", "Kavindi", "Janaka", "Dinesh", "Menaka", "Sarath"],
    last: ["Perera", "Fernando", "Silva", "Jayasinghe", "Wickramasinghe", "Gunawardena", "Rajapaksa", "De Silva", "Bandara", "Senanayake", "Karunaratne", "Weerasinghe", "Dissanayake", "Herath", "Samarasinghe", "Ratnayake", "Kumar", "Selvarajah", "Pathirana", "Amarasinghe"],
  },
  CY: {
    first: ["Andreas", "Maria", "Georgios", "Eleni", "Christos", "Elena", "Nikolas", "Sophia", "Marios", "Despina", "Costas", "Anna", "Panayiotis", "Christina", "Michalis", "Irene", "Stavros", "Katerina", "Loukas", "Evi"],
    last: ["Georgiou", "Christodoulou", "Charalambous", "Constantinou", "Ioannou", "Papadopoulos", "Michael", "Demetriou", "Savva", "Andreou", "Nicolaou", "Kyriacou", "Antoniou", "Pavlou", "Stylianou", "Hadjipanayi", "Mavrides", "Kouros", "Petrou", "Zachariou"],
  },
};

/** Titles for HR Admins (the role stays HR Admin whatever the title says). The first person in the department is always the lead. */
export const HR_ADMIN_TITLES = ["HR Administrator", "HR Systems Administrator", "HR Operations Specialist"] as const;

export interface DepartmentPlan {
  code: string;
  name: string;
  headTitle: string;
  /** HR Admins live in People & Culture only. */
  hrAdmins: number;
  employees: number;
  employeeTitles: string[];
}

// Totals: 100 people, 7 managers (exactly one per department, who heads it), 3 HR admins, 90 employees.
export const DEPARTMENTS: DepartmentPlan[] = [
  { code: "ENG", name: "Engineering", headTitle: "Director of Engineering", hrAdmins: 0, employees: 29, employeeTitles: ["Software Engineer", "Senior Software Engineer", "Junior Software Engineer", "Frontend Engineer", "Backend Engineer", "Full-Stack Engineer", "QA Engineer", "Test Automation Engineer", "DevOps Engineer", "Data Engineer", "Mobile Engineer", "Site Reliability Engineer"] },
  { code: "ITOPS", name: "IT Operations", headTitle: "Head of IT Operations", hrAdmins: 0, employees: 11, employeeTitles: ["IT Support Specialist", "Senior IT Support Specialist", "Systems Administrator", "Network Engineer", "Security Analyst", "Cloud Administrator", "Helpdesk Analyst", "Endpoint Engineer"] },
  { code: "PEOPLE", name: "People & Culture", headTitle: "Head of People & Culture", hrAdmins: 3, employees: 6, employeeTitles: ["HR Business Partner", "Recruiter", "Talent Acquisition Partner", "Payroll Specialist", "Learning & Development Specialist", "Employee Relations Specialist"] },
  { code: "FIN", name: "Finance", headTitle: "Finance Director", hrAdmins: 0, employees: 9, employeeTitles: ["Accountant", "Senior Accountant", "Financial Analyst", "Accounts Payable Officer", "Accounts Receivable Officer", "Treasury Analyst", "Payroll Accountant", "Budget Analyst"] },
  { code: "MKT", name: "Marketing", headTitle: "Marketing Director", hrAdmins: 0, employees: 13, employeeTitles: ["Digital Marketing Specialist", "Content Strategist", "Brand Designer", "SEO Analyst", "Social Media Manager", "Marketing Analyst", "Copywriter", "Product Marketing Specialist"] },
  { code: "LEGAL", name: "Legal & Compliance", headTitle: "Head of Legal & Compliance", hrAdmins: 0, employees: 5, employeeTitles: ["Legal Counsel", "Senior Legal Counsel", "Compliance Officer", "Contracts Specialist", "Data Protection Officer", "Paralegal"] },
  { code: "OPS", name: "Operations", headTitle: "Head of Operations", hrAdmins: 0, employees: 17, employeeTitles: ["Operations Coordinator", "Facilities Officer", "Office Administrator", "Procurement Officer", "Logistics Coordinator", "Vendor Manager Assistant", "Workplace Experience Officer", "Travel & Events Coordinator"] },
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
export const NEW_HIRES: { country: Shortcode; department: string }[] = [
  { country: "BD", department: "ENG" },
  { country: "BD", department: "MKT" },
  { country: "BD", department: "OPS" },
  { country: "MY", department: "FIN" },
  { country: "MY", department: "ITOPS" },
  { country: "LK", department: "ENG" },
  { country: "CY", department: "LEGAL" },
];

export const PERSONA_EMAILS = {
  hrAdmin: `hr.admin@${EMAIL_DOMAIN}`,
  manager: `manager@${EMAIL_DOMAIN}`,
  newHire: `new.hire@${EMAIL_DOMAIN}`,
  itSupport: `it.support@${EMAIL_DOMAIN}`,
  /** The Manager of IT Operations: the busiest team dashboard (requests, tasks and a new hire). */
  itManager: `it.manager@${EMAIL_DOMAIN}`,
} as const;
