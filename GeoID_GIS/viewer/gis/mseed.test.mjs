/**
 * miniSEED, against records a real service actually sent.
 *
 * A waveform reader cannot be checked by eye: differences integrate, so one
 * wrong nibble gives a wiggle that still looks like a seismogram. Two things
 * make this testable instead.
 *
 * FIRST, the format checks itself. A Steim frame carries the first sample and
 * the LAST sample as plain integers, so integrating from x0 must land exactly
 * on xn. That is a per-record assertion no plausible-looking corruption
 * survives, and it is asserted here on a real record rather than trusted.
 *
 * SECOND, the fixtures are real. `STEIM2` is 4,096 bytes of GE.STU BHZ from
 * GEOFON covering 01:18-01:20 UTC on 6 February 2023 — the M7.8 Kahramanmaras
 * earthquake, recorded in Stuttgart. `FLOAT64` is 2Q.AQG MGZ from ORFEUS, a
 * tiltmeter on Etna, which is encoding 5 and exercises the uncompressed path
 * and the negative-multiplier sample rate at once. Both were decoded
 * independently in Python first, and the expected values below are what that
 * reference produced.
 */

import {
  readHeader, readRecord, readStream, sampleRate, btimeMs, ENCODINGS,
} from "./mseed.js";

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`FAIL  ${name}  — ${e.message}`);
  }
}
function eq(a, b, what = "") {
  if (a !== b) throw new Error(`${what} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function near(a, b, tol, what = "") {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} expected ~${b}, got ${a}`);
}

/** Base64 to ArrayBuffer, without assuming a browser or a Buffer. */
function bytes(b64) {
  const bin = typeof atob === "function"
    ? atob(b64)
    : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/* GE.STU..BHZ, 2023-02-06T01:18Z — Steim-2, eight 512-byte records. */
const STEIM2 = ""
  + "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";

/* 2Q.AQG..MGZ, 2020-07-10T20:57Z — IEEE float64, 4096-byte record. */
const FLOAT64 = ""
  + "MDAwMDA0RCBBUUcgICAgTUdaMlEH5ADAFDkoAAbWAfgAMv/lAAAAAgAAAAAAQAAwA+kAOAABAAAD6AAABQEMAEAjnHna/ClM"
  + "QCOcec0X7atAI5x51BKigUAjnHnN5hY6QCOceclvoCJAI5x5z5OVZEAjnHnBYgqNQCOcecyF5kZAI5x5vuZi1UAjnHnF2ICl"
  + "QCOcecaM5CJAI5x5w1zY7UAjnHnRFiFwQCOceb9E4BZAI5x5zwolBEAjnHm6xdL5QCOcecNDE9tAI5x5wYRmpUAjnHm9Uqi9"
  + "QCOcec4IclJAI5x5wVlzh0AjnHnRWtmfQCOcecNc2O1AI5x5zCdpBEAjnHnGyQVMQCOcedD8XF5AI5x51yBRn0AjnHnX7nou"
  + "QCOcedqmQxBAI5x505pgLkAjnHnOb4aZQCOcec+tWnVAI5x5y+Kw1UAjnHnHJ4KNQCOcecZzHxBAI5x5viDRTEAjnHm9n/fz"
  + "QCOcecHreu1AI5x5xgwKyUAjnHnHn8ThQCOcedLMN59AI5x5yMxqsUAjnHnROH2HQCOceceOltVAI5x5yr6iCkAjnHnHhf/P"
  + "QCOceciQSYdAI5x50J3fHEAjnHnO58jsQCOced2z8i5AI5x52Ga8gUAjnHnjrPRSQCOcedlxBjpAI5x53MwEjUAjnHnTmmAu"
  + "QCOcecokA59AI5x5ybRYUkAjnHm7x4WrQCOcecPdskZAI5x5w5BjEEAjnHnNzFEoQCOcedoDDZ9AI5x518weFkAjnHne6S8E"
  + "QCOcedO0JUBAI5x50PxcXkAjnHnRwe3mQCOcecrg/iJAI5x51jhj/kAjnHnLLk1YQCOcedP43W9AI5x5ycWGXkAjnHnNmMcE"
  + "QCOcec60PslAI5x5y8BUvUAjnHnSXIxSQCOcecQ8L4dAI5x5yAbZKEAjnHm0MjJqQCOcebtgcWRAI5x5tIgYpUAjnHm8r3NM"
  + "QCOcec2hXgpAI5x5zLDZZEAjnHnlyh7JQCOced49Yo1AI5x56zmwjUAjnHnjviJdQCOced/iSrFAI5x54KfcOkAjnHnQnd8c"
  + "QCOcedxTwjpAI5x5xvP4aUAjnHnNfwHyQCOcecSA57dAI5x5uDj9NEAjnHnH7RQWQCOcebZX8+dAI5x5y8jrw0AjnHnIw9Or"
  + "QCOcedDaAEZAI5x52b5Vb0AjnHnTvLxGQCOcediRr59AI5x5zoC0pUAjnHnC9cSlQCOceb3tRyhAI5x5suvHh0AjnHm2cbj4"
  + "QCOceb4HDDpAI5x5xM427EAjnHnSBqYWQCOcec3mFjpAI5x52WhvNEAjnHnMJ2kEQCOcedUUVTRAI5x5zCdpBEAjnHnMScUc"
  + "QCOcecs/e2NAI5x5xWjVV0AjnHnLLk1YQCOcecWCmmlAI5x51HEfw0AjnHnQwDs0QCOceeIh0UBAI5x53oIavUAjnHnivG+r"
  + "QCOcedzdMplAI5x50LekLkAjnHnQNsrUQCOcecGVlLFAI5x5ybzvV0AjnHnEiX69QCOcecht7W9AI5x5xvP4aUAjnHnDD4m3"
  + "QCOcecEMJFJAI5x5v4EBQEAjnHnEq9rVQCOcecbRnFJAI5x5yfkQgUAjnHnOGaBdQCOcecWcX3tAI5x5ykZft0AjnHnCwjqB"
  + "QCOcecQIpWNAI5x5wzHlz0AjnHnA6cg6QCOcecaM5CJAI5x5wHoc7EAjnHnMsNljQCOcecKodW9AI5x5zYeY+EAjnHnBHVJd"
  + "QCOcecX63L1AI5x5xVenTEAjnHnHfWjJQCOcedgiBFJAI5x51i/M+EAjnHnjaDwiQCOcedxcWUBAI5x53iw0gUAjnHnalRUE"
  + "QCOceddLRL1AI5x51i/M+EAjnHnQrw0oQCOcecyfq1dAI5x5xRLvHEAjnHnEtHHaQCOcebym3EZAI5x5vu752kAjnHnCWyY6"
  + "QCOceb73kOBAI5x5yYDOLkAjnHnFV6dMQCOcecSJfr1AI5x5x1sMsUAjnHnAgrPyQCOcecr6wzRAI5x5yvrDNEAjnHnVAyco"
  + "QCOceddtoNRAI5x52Rsf/kAjnHnVt4qlQCOcedlOqiJAI5x51uQwdUAjnHnc7mClQCOceeS/1RBAI5x53ed8UUAjnHnmqXVj"
  + "QCOcedkBWuxAI5x52tE2LkAjnHnUPZWfQCOcedJcjFFAI5x5zirOaUAjnHnHMBmTQCOcecLb/5NAI5x5u4LNe0AjnHm61wEE"
  + "QCOcebiXenVAI5x5uQ+8yUAjnHm80c9jQCOceb2f9/JAI5x5xi5m4EAjnHnJIlDsQCOcec5Ek3tAI5x507QlQEAjnHnSU/VM"
  + "QCOcedk9fBZAI5x50xDvzkAjnHndTN3mQCOcedWdxZNAI5x53RlTw0AjnHndVXTsQCOcedpHxc5AI5x55cGHw0AjnHnajH3+"
  + "QCOceeaYR1dAI5x52HfqjUAjnHnd3uVLQCOcedmTYlFAI5x52JpGpUAjnHnhy+sEQCOcedxcWUBAI5x54fbeIkAjnHndVXTs"
  + "QCOcedoc0rFAI5x51YyXh0AjnHnU6WIWQCOcedAL17dAI5x506uOOkAjnHnT8EZpQCOcedTPnQRAI5x51ODLEEAjnHnQ/Fxd"
  + "QCOcec+TlWNAI5x5zSkbt0AjnHnRHrh1QCOcedPfGF1AI5x51UffV0AjnHnXBoyNQCOcedIxmTRAI5x5zORjh0AjnHnJoypG"
  + "QCOcecGvWcNAI5x5xBnTb0AjnHm/ACfmQCOcecQRPGlAI5x5xNbN8kAjnHnFEu8cQCOcedAlnMhAI5x5yZH8OkAjnHnS9yq9"
  + "QCOcecdjo7dAI5x5wQwkUUAjnHm8wKFXQCOcebFG32NAI5x5w4fMCkAjnHm/ACfmQCOcedkBWuxAI5x520l4gUAjnHnh/3Uo"
  + "QCOceeoVocJAI5x54B5r2kAjnHnruonmQCOced6CGr1AI5x56JusvUAjnHnem9/OQCOceeIh0UBAI5x531BDS0AjnHnZCfHy"
  + "QCOcedoDDZ9AI5x50Z+RzkAjnHnYKptXQCOceda5PVdAI5x53s9p8kAjnHncU8I6QCOcedwgOBZAI5x51lIpEEAjnHnTtCVA"
  + "QCOcedG5VuBAI5x5zLlwaUAjnHnNIISxQCOcecQ8L4dAI5x5xVenS0AjnHnDfzUEQCOcecN/NQRAI5x5y9oZzkAjnHnI7sbJ"
  + "QCOcedBQj+ZAI5x5000Q+EAjnHnQHQXDQCOcedz/jrFAI5x50YXMvUAjnHnVt4qlQCOcec0pG7dAI5x5wCQ2sUAjnHnD3bJG"
  + "QCOcebjTm59AI5x5wT+udUAjnHnCqHVvQCOcecjVAbdAI5x5yEL6UUAjnHnQ2gBGQCOcecgpNUBAI5x5zW3T5kAjnHnJ5+J1"
  + "QCOcecKGGVdAI5x5yrYLBEAjnHm9hjLgQCOcect7nI1AI5x5wYz9q0AjnHnLe5yNQCOcecY/lOxAI5x5yYllNEAjnHnLhDOT"
  + "QCOceco1MatAI5x50Th9h0AjnHnGFKHOQCOcecumj6tAI5x5wIKz8kAjnHnARpLIQCOcecfCIPhAI5x5v2c8LkAjnHnRHrh1"
  + "QCOcecosmqVAI5x50/jdb0AjnHnanawKQCOcedScEuBAI5x54Q7wgUAjnHnRuVbgQCOcedhvU4dAI5x5zNM1e0AjnHnQrw0o"
  + "QCOcec6rp8NAI5x5zoC0pUAjnHnXZQnOQCOcec681c5AI5x52hQ7q0AjnHnPiv5dQCOcec6aebdAI5x5yP/01EAjnHm5svI6"
  + "QCOcebucko1AI5x5rXw1w0AjnHmyJjX+QCOcebXOg4dAI5x5tx2Fb0AjnHnF2IClQCOcecf1qxxAI5x5zm+GmUAjnHnSuwmT"
  + "QCOcedI6MDpAI5x51M+dBEAjnHnWqA9MQCOcedQj0I1AI5x504kyIkAjnHnPAY3+QCOcecuMyplAI5x5zYeY+EAjnHnLJbZS"
  + "QCOcedCVSBZAI5x5zSCEsUAjnHnOkeKxQCOcec2HmPhAI5x5x8q3/kAjnHnK+sM0QCOcecE3F29AI5x5w0uq4EAjnHnD93dX"
  + "QCOcecSjQ89AI5x5zghyUkAjnHnNfwHyQCOcedCVSBZAI5x5zyyBHEAjnHnMuXBpQCOcec89ryhAI5x5yq1z/kAjnHnN3X80"
  + "QCOcecpGX7dAI5x5zP4omUAjnHnOiUurQCOcedRoiL1AI5x52DMyXUAjnHnZistMQCOceeDKOFFAI5x51uzHe0AjnHneGwZ1"
  + "QCOcec+18XtAI5x5zkSTe0AjnHnE1s3yQCOcecLklplAI5x5wmxURkAjnHnDw+00QCOcec3/20xAI5x5xcdSmUAjnHnV0U+3"
  + "QCOcecYdONVAI5x5z2iiRkAjnHnLWUB1QCOcecWTyHVAI5x5zbKMFkAjnHnAx2wiQCOcecb8j29AI5x5vjH/WEAjnHnBUNyB"
  + "QCOceborNI1AI5x5vI0XNEAjnHm7rcCZQCOcebkYU89AI5x5xCsBe0AjnHm/gQFAQCOceco9yLFAI5x5zPWRk0AjnHnMY4ou"
  + "QCOcedXzq89AI5x5y+Kw1UAjnHnR9XgKQCOcecsuTVhAI5x5x2w6vUAjnHnM7PqNQCOcecAszbdAI5x5ynFS1UAjnHm9dQTV"
  + "QCOceb/W53tAI5x5vcrrEEAjnHm6RPmfQCOceb5liXtAI5x5vPzCgUAjnHm+INFMQCOcebyVrjpAI5x5v4mYRkAjnHm6b+y9"
  + "QCOceb/5Q5NAI5x5umdVt0AjnHm70ByxQCOceb4HDDpAI5x5u/J4yUAjnHnGHTjVQCOcecftFBZAI5x5z/ISpUAjnHnXdjfb"
  + "QCOcedg7yWRAI5x527kjz0AjnHnXBoyNQCOcedTx+RxAI5x5zNM1e0AjnHnKLJqlQCOcecZqiApAI5x5wOExNEAjnHnIKTVA"
  + "QCOcecMgt8NAI5x5z3E5TEAjnHnV86vPQCOcedm1vmlAI5x55XQ4jUAjnHncZPBGQCOcedyhEW9AI5x51E7Dq0AjnHnIsqWf"
  + "QCOcecqtc/5AI5x5v+gVh0AjnHnDMeXPQCOcecCLSvhAI5x5uvDGFkAjnHm8r3NMQCOcebXoSJlAI5x5uprf20AjnHm7vu6l"
  + "QCOcecEMJFJAI5x5xHhQsUAjnHnNMbK9QCOcecpou89AI5x51o5KOkAjnHnRbAerQCOcedKp24dAI5x52CqbWEAjnHnKeenb"
  + "QCOcedt0a59AI5x5zMqedUAjnHnaaiHnQCOcedoc0rFAI5x52PAs4UAjnHnhXD+3QCOcedXRT7dAI5x51+XjKEAjnHnNzFEo"
  + "QCOcecr6wzRAI5x5xmqICkAjnHnI5i/DQCOcecVo1VhAI5x5y/Pe4UAjnHnIIJ46QCOcec3U6C5AI5x5zoC0pUAjnHnQ/Fxe"
  + "QCOcedh36o1AI5x5122g1UAjnHnb0ujhQCOcedrzkkZAI5x51w8jk0AjnHnRbAerQCOcedUlg0BAI5x5yz97ZA==";

/* ── the sample rate, which has four sign cases and one obvious wrong read ── */

check("sample rate: both positive multiplies", () => eq(sampleRate(20, 1), 20));
check("sample rate: negative multiplier divides", () => near(sampleRate(50, -27), 50 / 27, 1e-12));
check("sample rate: negative factor is a period", () => eq(sampleRate(-20, 1), 0.05));
check("sample rate: both negative", () => near(sampleRate(-10, -2), 1 / 20, 1e-12));

check("SEED time is day-of-year, not month", () => {
  // 2023 day 37 is 6 February.
  eq(btimeMs(2023, 37, 1, 18, 0, 0), Date.UTC(2023, 1, 6, 1, 18, 0));
});

/* ── the Steim-2 record ───────────────────────────────────────────────────── */

check("reads the header of a real Steim-2 record", () => {
  const h = readHeader(new DataView(bytes(STEIM2)), 0);
  eq(h.id, "GE.STU..BHZ", "channel id");
  eq(h.encoding, 11, "encoding");
  eq(ENCODINGS[h.encoding], "Steim-2", "encoding name");
  // 512, from the record's own blockette 1000. The response is 4,096 bytes,
  // which is EIGHT records -- assuming the file length is the record length is
  // exactly the mistake the reference decode made before this test caught it.
  eq(h.recordLength, 512, "record length");
  eq(h.sampleCount, 403, "sample count");
  eq(h.sampleRate, 20, "sample rate");
  eq(h.dataOffset, 64, "data offset");
});

check("decodes Steim-2 and PASSES the format's own integrity check", () => {
  const r = readRecord(bytes(STEIM2));
  eq(r.ok, true, `integrity (ends ${r.actualLast}, header says ${r.expectedLast})`);
  eq(r.samples.length, 403, "samples");
});

check("Steim-2 samples match the independent reference decode", () => {
  const r = readRecord(bytes(STEIM2));
  // First twelve, from the Python reference.
  const want = [-1235, -1269, -1314, -1270, -1234, -1300, -1339, -1303,
                -1249, -1235, -1281, -1304];
  want.forEach((v, i) => eq(r.samples[i], v, `sample ${i}`));
  eq(r.samples[402], -1338, "last sample is xn");
  eq(Math.min(...r.samples), -1951, "minimum");
  eq(Math.max(...r.samples), -256, "maximum");
});

check("a corrupted Steim-2 record is REPORTED, not returned as a wiggle", () => {
  const buf = bytes(STEIM2);
  // Flip one bit deep in the frame data: the differences after it all shift,
  // the trace still looks like a seismogram, and xn no longer matches.
  new DataView(buf).setUint8(200, new DataView(buf).getUint8(200) ^ 0x01);
  const r = readRecord(buf);
  eq(r.ok, false, "must not claim a corrupted record is fine");
});

/* ── the uncompressed record ──────────────────────────────────────────────── */

check("reads an IEEE float64 record, and its odd sample rate", () => {
  const r = readRecord(bytes(FLOAT64));
  eq(r.header.id, "2Q.AQG..MGZ", "channel id");
  eq(r.header.encoding, 5, "encoding");
  eq(r.ok, true, "no integrity pair to fail");
  eq(r.samples.length, 504, "samples");
  // 50 / 27 Hz: the negative-multiplier case, read as a product would give
  // 1350 Hz and every spectrum from it would be wrong by 729x.
  near(r.header.sampleRate, 50 / 27, 1e-9, "sample rate");
  eq(Number.isFinite(r.samples[0]), true, "first sample is a number");
});

/* ── a whole response ─────────────────────────────────────────────────────── */

check("a stream groups eight records into one continuous trace", () => {
  const out = readStream(bytes(STEIM2));
  eq(out.records, 8, "records read");
  eq(out.traces.length, 1, "one channel, one trace");
  eq(out.problems.length, 0, `problems: ${out.problems.join("; ")}`);
  const t = out.traces[0];
  eq(t.id, "GE.STU..BHZ", "id");
  // 403 + 380 + 364 + 395 + 393 + 413 + 415 + 405, from the reference.
  eq(t.values.length, 3168, "values");
  near(t.durationS, 3168 / 20, 1e-9, "duration");
  eq(t.seconds[0], 0, "time starts at zero");
  near(t.seconds[1], 0.05, 1e-12, "one sample is 1/20 s");
});

check("EVERY record in the stream passes its own integrity check", () => {
  // Eight independent x0/xn pairs: if the frame walk drifted anywhere, one of
  // them lands somewhere other than the value its header names.
  const buf = bytes(STEIM2);
  for (let at = 0; at < buf.byteLength; at += 512) {
    const r = readRecord(buf, at);
    eq(r.ok, true, `record at ${at} (ends ${r.actualLast}, header says ${r.expectedLast})`);
  }
});

check("the record length comes from the record, not from the response size", () => {
  // Reading the 4,096-byte response as one record -- which is what the first
  // reference decode did -- loses seven eighths of the earthquake.
  const out = readStream(bytes(STEIM2));
  eq(out.records, 8, "eight 512-byte records");
});

check("an unreadable encoding says which one rather than returning zeros", () => {
  const buf = bytes(STEIM2);
  const view = new DataView(buf);
  // Blockette 1000's encoding byte: make it Steim-3, which is real and rare.
  const first = view.getUint16(46);
  view.setUint8(first + 4, 19);
  const r = readRecord(buf);
  eq(r.ok, false, "not ok");
  eq(/Steim-3/.test(r.message || ""), true, `names the encoding: ${r.message}`);
});

if (failures.length) process.exitCode = 1;
export const results = { passed, failures };
