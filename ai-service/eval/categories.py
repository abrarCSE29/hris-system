"""The categories and departments the real platform has (see backend seed), used to build evaluation requests."""

CATEGORIES = [
    {"code": "IT_EQUIPMENT", "name": "IT Equipment", "department": "ITOPS",
     "description": "Laptops, monitors, keyboards, phones, chargers and other hardware: faults, replacements and new equipment."},
    {"code": "SOFTWARE_ACCESS", "name": "Software Access", "department": "ITOPS",
     "description": "Accounts, passwords, logins, VPN, licences and access to software or systems, including suspected account compromise."},
    {"code": "HR_QUERY", "name": "HR Query", "department": "PEOPLE",
     "description": "Leave, payroll, benefits, contracts, personal details, workplace concerns and other people questions."},
    {"code": "FACILITIES", "name": "Facilities", "department": "OPS",
     "description": "The office and its furniture and services: desks, chairs, air conditioning, lighting, kitchen, cleaning and building access."},
    {"code": "OTHER", "name": "Other", "department": "PEOPLE",
     "description": "Anything that does not fit the other categories."},
]

DEPARTMENTS = [
    {"code": "ENG", "name": "Engineering"}, {"code": "ITOPS", "name": "IT Operations"}, {"code": "PEOPLE", "name": "People & Culture"},
    {"code": "FIN", "name": "Finance"}, {"code": "MKT", "name": "Marketing"}, {"code": "LEGAL", "name": "Legal & Compliance"},
    {"code": "OPS", "name": "Operations"},
]
