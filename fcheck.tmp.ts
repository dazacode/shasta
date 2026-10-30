import { checkDomain } from "./server/src/services/filters/index";
const domains = process.argv.slice(2);
for (const d of domains) {
  try {
    const r = await checkDomain(d, { fresh: true });
    console.log("\n=== " + d + " ===");
    for (const v of r.vendors) {
      console.log(`${v.name}\t${v.status}\traw=${JSON.stringify(v.raw)}\tcat=${JSON.stringify(v.category)}\tbasis=${v.basis ?? ""}`);
    }
  } catch (e) { console.log("\n=== " + d + " ERROR: " + (e as Error).message); }
}
