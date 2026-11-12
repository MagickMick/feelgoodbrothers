/**
 * Create or update an admin user.
 *   npm run create-admin -- you@example.com "Your Name"
 * The password is read from ADMIN_PASSWORD or prompted (hidden).
 */
import { createInterface } from "node:readline";
import { getDb, closeDb } from "../src/db.ts";
import { adminUsers } from "../src/schema.ts";
import { hashPassword } from "../src/auth.ts";

async function promptHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const anyRl = rl as any;
  anyRl._writeToOutput = (s: string) => {
    if (s.includes(question)) anyRl.output.write(s);
  };
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    }),
  );
}

const [email, ...nameParts] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run create-admin -- you@example.com "Your Name"');
  process.exit(1);
}
const password = process.env.ADMIN_PASSWORD || (await promptHidden("Password (min 12 chars): "));
if (password.length < 12) {
  console.error("Password must be at least 12 characters");
  process.exit(1);
}

const passwordHash = await hashPassword(password);
await getDb()
  .insert(adminUsers)
  .values({ email: email.toLowerCase(), name: nameParts.join(" "), passwordHash })
  .onConflictDoUpdate({ target: adminUsers.email, set: { passwordHash, name: nameParts.join(" ") } });

console.log(`✓ admin user ${email} saved`);
await closeDb();
