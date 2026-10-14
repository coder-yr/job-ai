// packages/db/prisma/seed.ts  - run with: npx prisma db seed
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import { prisma } from "../src/client.js";

const SKILLS: [string, string, string, string[]][] = [
  // name, display, category, aliases
  ["javascript", "JavaScript", "language", ["js", "ecmascript", "es6"]],
  ["typescript", "TypeScript", "language", ["ts"]],
  ["python", "Python", "language", ["py", "python3"]],
  ["java", "Java", "language", []],
  ["c++", "C++", "language", ["cpp"]],
  ["c#", "C#", "language", ["csharp", "c sharp"]],
  ["sql", "SQL", "language", ["structured query language"]],
  ["html", "HTML", "language", ["html5"]],
  ["css", "CSS", "language", ["css3"]],
  ["react", "React", "framework", ["reactjs", "react.js"]],
  ["next.js", "Next.js", "framework", ["nextjs", "next"]],
  ["node.js", "Node.js", "framework", ["node", "nodejs"]],
  ["express", "Express", "framework", ["expressjs", "express.js"]],
  ["django", "Django", "framework", []],
  ["flask", "Flask", "framework", []],
  ["spring boot", "Spring Boot", "framework", ["springboot", "spring"]],
  ["postgresql", "PostgreSQL", "database", ["postgres", "psql"]],
  ["mysql", "MySQL", "database", []],
  ["mongodb", "MongoDB", "database", ["mongo"]],
  ["redis", "Redis", "database", []],
  ["prisma", "Prisma", "tool", []],
  ["git", "Git", "tool", ["github", "version control"]],
  ["docker", "Docker", "tool", ["containers"]],
  ["linux", "Linux", "tool", ["ubuntu", "bash"]],
  ["rest api", "REST API", "tool", ["rest", "restful", "restful api", "api development"]],
  ["graphql", "GraphQL", "tool", []],
  ["aws", "AWS", "cloud", ["amazon web services"]],
  ["azure", "Azure", "cloud", ["microsoft azure"]],
  ["jest", "Jest", "tool", ["unit testing"]],
  ["playwright", "Playwright", "tool", []],
  ["tailwind css", "Tailwind CSS", "framework", ["tailwind"]],
  ["machine learning", "Machine Learning", "other", ["ml"]],
  ["data structures", "Data Structures", "other", ["dsa", "data structures and algorithms"]],
];

async function main() {
  for (const [name, display, category, aliases] of SKILLS) {
    await prisma.skill.upsert({ where: { name }, update: { display, category, aliases }, create: { name, display, category, aliases } });
  }
  console.log(`Seeded ${SKILLS.length} skills`);
}
main().finally(() => prisma.$disconnect());
