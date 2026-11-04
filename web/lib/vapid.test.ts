import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sendEmptyPush, vapidAuthorization, vapidKeys } from "./vapid";

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64url");
  return { publicKey: pub, privateKey: privateKey.export({ format: "jwk" }).d!, verifyKey: publicKey };
}

describe("vapidKeys", () => {
  it("is null unless both keys are set and well formed (the feature is then off)", () => {
    const k = keys();
    expect(vapidKeys({})).toBeNull();
    expect(vapidKeys({ VAPID_PUBLIC_KEY: k.publicKey })).toBeNull();
    expect(vapidKeys({ VAPID_PUBLIC_KEY: "abc", VAPID_PRIVATE_KEY: k.privateKey })).toBeNull();
    expect(vapidKeys({ VAPID_PUBLIC_KEY: ` ${k.publicKey}\n`, VAPID_PRIVATE_KEY: k.privateKey })).toEqual({ publicKey: k.publicKey, privateKey: k.privateKey });
  });
});

describe("vapidAuthorization", () => {
  it("is an ES256 JWT for the push service's origin that the public key verifies", () => {
    const k = keys();
    const h = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", k, 1_800_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(k.publicKey);
    expect(JSON.parse(Buffer.from(m[1], "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(Buffer.from(m[2], "base64url").toString());
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.exp).toBe(1_800_000_000 + 12 * 3600);
    expect(claims.sub).toMatch(/^https:\/\//);
    const ok = verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key: k.verifyKey, dsaEncoding: "ieee-p1363" }, Buffer.from(m[3], "base64url"));
    expect(ok).toBe(true);
  });
});

describe("sendEmptyPush", () => {
  it("POSTs no body with the push headers and returns the status; 0 when unreachable", async () => {
    const k = keys();
    let seen: RequestInit | undefined;
    const status = await sendEmptyPush("https://fcm.googleapis.com/x", k, 1_800_000_000, (async (_u: string, init: RequestInit) => {
      seen = init;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch);
    expect(status).toBe(201);
    expect(seen?.method).toBe("POST");
    expect(seen?.body).toBeUndefined();
    expect((seen?.headers as Record<string, string>).TTL).toBe(String(6 * 3600));
    expect(await sendEmptyPush("https://fcm.googleapis.com/x", k, 1, (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBe(0);
  });
});
