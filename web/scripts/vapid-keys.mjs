// Prints a new VAPID key pair for the "notify me" push reminders (web/lib/vapid.ts). Run once, then add both to the Vercel project:
//   node scripts/vapid-keys.mjs
//   vercel env add VAPID_PUBLIC_KEY production   (paste the first value)
//   vercel env add VAPID_PRIVATE_KEY production  (paste the second; keep it secret)
// Changing the keys later cuts off every reminder already set (browsers subscribed with the old public key).
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const point = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
console.log(`VAPID_PUBLIC_KEY=${point.toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey.export({ format: "jwk" }).d}`);
