import "dotenv/config";
import { db, closeDb } from "./index";
import { greetings } from "./schema";

async function main() {
  const existing = await db.select().from(greetings).limit(1);
  if (existing.length === 0) {
    await db.insert(greetings).values({ message: "Hello from Postgres 👋" });
    console.log("Seeded greetings table.");
  } else {
    console.log("greetings already seeded — nothing to do.");
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
