/**
 * miniSEED, read in the browser.
 *
 * Seismic waveforms are distributed as miniSEED and essentially nothing else:
 * every FDSN service on Earth answers `dataselect` with it, so a page that
 * cannot read this format cannot look at a seismogram, however many APIs it
 * can reach. There is no runtime for it here for the same reason there is no
 * protobuf runtime beside `mvt.js` — the parts that matter are a fixed header
 * and two compression schemes, and 300 lines is cheaper than a dependency and
 * far cheaper than not having the capability.
 *
 * WHAT IT READS
 *
 * The fixed data header (SEED 2.4 §8.2), blockette 1000 for the encoding and
 * record length, and these encodings:
 *
 *   1  16-bit integers          10  Steim-1 compression
 *   3  32-bit integers          11  Steim-2 compression
 *   4  IEEE float32
 *   5  IEEE float64
 *
 * 10 and 11 are the ones that matter: broadband seismic data is Steim-2
 * almost everywhere, and a reader without it can open the metadata channels
 * and none of the seismograms.
 *
 * THE FORMAT CHECKS ITSELF, AND THIS USES THAT.
 *
 * A Steim frame stores DIFFERENCES, not samples, so one wrong nibble corrupts
 * every value after it and nothing about the output looks wrong — it is still
 * a plausible wiggle. Steim's answer is that the first frame carries the first
 * sample (`x0`) and the LAST sample (`xn`) as plain 32-bit integers, so
 * integrating the differences from x0 must land exactly on xn. `decode`
 * returns that comparison rather than hiding it, and `readRecord` refuses a
 * record that fails it. A seismogram that is quietly wrong is worse than no
 * seismogram.
 *
 * Byte order is big-endian throughout: SEED is, and blockette 1000 carries a
 * word-order flag which is 1 (big) on every service anyone federates with.
 * The flag is read and honoured anyway, because "nobody does that" is how a
 * file that does it gets misread in silence.
 */

const B1000 = 1000;

/* ── the fixed header ─────────────────────────────────────────────────────── */

const ascii = (view, at, len) => {
  let s = "";
  for (let i = 0; i < len; i += 1) s += String.fromCharCode(view.getUint8(at + i));
  return s.trim();
};

/**
 * SEED's sample rate is a factor and a multiplier, and both may be negative.
 *
 * The four sign combinations mean four different things, and reading it as
 * `factor * multiplier` is right in exactly one of them: at 20 Hz the pair is
 * (20, 1), but at 0.05 Hz it is (-20, 1) and at 1.85 Hz it is (50, -27). Get
 * this wrong and every spectrum computed from the trace is wrong by a factor
 * nobody will notice, because the shape is unchanged.
 */
export function sampleRate(factor, multiplier) {
  if (factor > 0 && multiplier > 0) return factor * multiplier;
  if (factor > 0 && multiplier < 0) return -factor / multiplier;
  if (factor < 0 && multiplier > 0) return -multiplier / factor;
  if (factor < 0 && multiplier < 0) return 1 / (factor * multiplier);
  return 0;
}

/** The record's start time, as epoch milliseconds. SEED counts days, not months. */
export function btimeMs(year, doy, hour, min, sec, tenthMilli) {
  const jan1 = Date.UTC(year, 0, 1);
  return jan1
    + (doy - 1) * 86400000
    + hour * 3600000 + min * 60000 + sec * 1000
    + Math.round(tenthMilli / 10);
}

/**
 * Header + blockette 1000, without touching the samples.
 *
 * Separate from `readRecord` because a caller often wants only this: which
 * channel is this, how many samples, at what rate — and decoding a megabyte of
 * Steim to answer that would be absurd.
 */
export function readHeader(view, offset = 0) {
  const sequence = ascii(view, offset + 0, 6);
  const quality = String.fromCharCode(view.getUint8(offset + 6));
  const station = ascii(view, offset + 8, 5);
  const location = ascii(view, offset + 13, 2);
  const channel = ascii(view, offset + 15, 3);
  const network = ascii(view, offset + 18, 2);
  const year = view.getUint16(offset + 20);
  const doy = view.getUint16(offset + 22);
  const hour = view.getUint8(offset + 24);
  const minute = view.getUint8(offset + 25);
  const second = view.getUint8(offset + 26);
  const tenthMilli = view.getUint16(offset + 28);
  const sampleCount = view.getUint16(offset + 30);
  const rateFactor = view.getInt16(offset + 32);
  const rateMultiplier = view.getInt16(offset + 34);
  const blocketteCount = view.getUint8(offset + 39);
  const dataOffset = view.getUint16(offset + 44);
  const firstBlockette = view.getUint16(offset + 46);

  let encoding = null;
  let bigEndian = true;
  let recordLength = null;
  let at = firstBlockette;
  for (let i = 0; i < blocketteCount && at > 0 && at + 4 <= view.byteLength; i += 1) {
    const type = view.getUint16(offset + at);
    const next = view.getUint16(offset + at + 2);
    if (type === B1000) {
      encoding = view.getUint8(offset + at + 4);
      bigEndian = view.getUint8(offset + at + 5) === 1;
      recordLength = 2 ** view.getUint8(offset + at + 6);
      break;
    }
    if (!next || next <= at) break;
    at = next;
  }

  return {
    sequence,
    quality,
    network,
    station,
    location,
    channel,
    id: `${network}.${station}.${location}.${channel}`,
    startMs: btimeMs(year, doy, hour, minute, second, tenthMilli),
    sampleCount,
    sampleRate: sampleRate(rateFactor, rateMultiplier),
    encoding,
    bigEndian,
    recordLength,
    dataOffset,
  };
}

/* ── Steim ────────────────────────────────────────────────────────────────── */

/** Sign-extend the low `bits` of `value`, which is most of what Steim is. */
function signed(value, bits) {
  const half = 1 << (bits - 1);
  return (value & (half - 1)) - (value & half);
}

/**
 * Steim-1 and Steim-2 in one walk, because they differ only in how a word is
 * cut up.
 *
 * Both pack differences into 64-byte frames: word 0 is sixteen 2-bit nibbles
 * saying what each of the other fifteen words holds, and in the FIRST frame
 * words 1 and 2 are not data at all — they are x0 and xn. The schemes part
 * company at control 2 and 3: Steim-1 has fixed layouts (two 16-bit, one
 * 32-bit), while Steim-2 steals the top two bits of the word as a second
 * nibble and supports 4-, 5-, 6-, 10-, 15- and 30-bit packings. That density
 * is why Steim-2 is what broadband data actually uses.
 */
function steimDifferences(view, start, end, two) {
  const diffs = [];
  let x0 = null;
  let xn = null;
  for (let frame = start; frame + 64 <= end; frame += 64) {
    const nibbles = view.getUint32(frame);
    for (let w = 1; w < 16; w += 1) {
      const control = (nibbles >>> (30 - 2 * w)) & 0x3;
      const at = frame + 4 * w;
      if (control === 0) {
        // Non-data. In the first frame these two words are the integrity pair.
        if (frame === start && w === 1) x0 = view.getInt32(at);
        if (frame === start && w === 2) xn = view.getInt32(at);
        continue;
      }
      const word = view.getUint32(at);
      if (control === 1) {
        // Four 8-bit differences, both schemes.
        for (let b = 0; b < 4; b += 1) diffs.push(signed((word >>> (24 - 8 * b)) & 0xFF, 8));
        continue;
      }
      if (!two) {
        // Steim-1: control 2 is two 16-bit, control 3 is one 32-bit.
        if (control === 2) {
          diffs.push(signed((word >>> 16) & 0xFFFF, 16), signed(word & 0xFFFF, 16));
        } else {
          diffs.push(view.getInt32(at));
        }
        continue;
      }
      // Steim-2: the top two bits say how the remaining 30 are cut.
      const dnib = word >>> 30;
      let count = 0;
      let bits = 0;
      if (control === 2) {
        if (dnib === 1) { count = 1; bits = 30; }
        else if (dnib === 2) { count = 2; bits = 15; }
        else if (dnib === 3) { count = 3; bits = 10; }
      } else if (dnib === 0) { count = 5; bits = 6; }
      else if (dnib === 1) { count = 6; bits = 5; }
      else if (dnib === 2) { count = 7; bits = 4; }
      for (let i = 0; i < count; i += 1) {
        diffs.push(signed((word >>> (bits * (count - 1 - i))) & ((1 << bits) - 1), bits));
      }
    }
  }
  return { diffs, x0, xn };
}

/**
 * Differences to samples, and the integrity check that makes it trustworthy.
 *
 * The first difference is not a difference — it is the offset that produced
 * x0 — so integration starts AT x0 and consumes the rest. Landing anywhere but
 * xn means the frame walk went wrong, and the only honest response is to say
 * so: the numbers would still plot as a convincing seismogram.
 */
function integrate(diffs, x0, xn, sampleCount) {
  const out = new Float64Array(sampleCount);
  if (!sampleCount) return { samples: out, ok: true };
  let value = x0 ?? 0;
  out[0] = value;
  for (let i = 1; i < sampleCount; i += 1) {
    value += diffs[i] ?? 0;
    out[i] = value;
  }
  const ok = xn === null || xn === undefined || out[sampleCount - 1] === xn;
  return { samples: out, ok, expectedLast: xn, actualLast: out[sampleCount - 1] };
}

/* ── one record ───────────────────────────────────────────────────────────── */

/** SEED encoding code -> what it means, for error messages that name the gap. */
export const ENCODINGS = {
  0: "ASCII text",
  1: "16-bit integers",
  3: "32-bit integers",
  4: "IEEE float32",
  5: "IEEE float64",
  10: "Steim-1",
  11: "Steim-2",
  19: "Steim-3",
};

/**
 * Read one record: header, samples, and whether the samples can be trusted.
 *
 * Returns `{ header, samples, ok }` rather than throwing on a failed integrity
 * check, so a caller can keep the good records out of a long stream and say
 * how many it dropped — which is what a real archive needs, since one bad
 * record in an hour of data is not a reason to show nothing.
 */
export function readRecord(buffer, offset = 0) {
  const view = new DataView(buffer, offset);
  const header = readHeader(view, 0);
  const { encoding, dataOffset, sampleCount } = header;
  const end = header.recordLength || view.byteLength;

  if (encoding === 10 || encoding === 11) {
    const { diffs, x0, xn } = steimDifferences(view, dataOffset, end, encoding === 11);
    const { samples, ok, expectedLast, actualLast } = integrate(diffs, x0, xn, sampleCount);
    return { header, samples, ok, expectedLast, actualLast };
  }

  const samples = new Float64Array(sampleCount);
  const little = !header.bigEndian;
  for (let i = 0; i < sampleCount; i += 1) {
    if (encoding === 1) samples[i] = view.getInt16(dataOffset + i * 2, little);
    else if (encoding === 3) samples[i] = view.getInt32(dataOffset + i * 4, little);
    else if (encoding === 4) samples[i] = view.getFloat32(dataOffset + i * 4, little);
    else if (encoding === 5) samples[i] = view.getFloat64(dataOffset + i * 8, little);
    else {
      return {
        header,
        samples: new Float64Array(0),
        ok: false,
        message: `encoding ${encoding} (${ENCODINGS[encoding] || "unknown"}) is not read here`,
      };
    }
  }
  return { header, samples, ok: true };
}

/**
 * A whole `dataselect` response: many records, usually one channel, in order.
 *
 * The record length is in each record's own blockette 1000 rather than fixed
 * for the stream, so the walk reads a header, takes that record's length, and
 * steps by it. Assuming 512 — the commonest — silently reads garbage from any
 * service that returns 4096, which GEOFON does.
 *
 * Records are grouped by channel id and concatenated in time order, because
 * one request can legitimately return several channels and stitching them into
 * one array would produce a trace that is not of anything.
 */
export function readStream(buffer) {
  const traces = new Map();
  const problems = [];
  let at = 0;
  let records = 0;
  while (at + 64 <= buffer.byteLength) {
    let record;
    try {
      record = readRecord(buffer, at);
    } catch (error) {
      problems.push(`record at byte ${at}: ${error.message}`);
      break;
    }
    const length = record.header.recordLength;
    if (!length || at + length > buffer.byteLength + 1) {
      problems.push(`record at byte ${at}: no usable record length`);
      break;
    }
    records += 1;
    if (!record.ok) {
      problems.push(record.message
        || `record ${record.header.sequence}: integrity check failed `
           + `(ends ${record.actualLast}, header says ${record.expectedLast})`);
    } else if (record.samples.length) {
      const key = record.header.id;
      if (!traces.has(key)) {
        traces.set(key, {
          id: key,
          network: record.header.network,
          station: record.header.station,
          location: record.header.location,
          channel: record.header.channel,
          sampleRate: record.header.sampleRate,
          startMs: record.header.startMs,
          chunks: [],
          count: 0,
        });
      }
      const trace = traces.get(key);
      trace.chunks.push(record.samples);
      trace.count += record.samples.length;
    }
    at += length;
  }

  const out = [...traces.values()].map((trace) => {
    const values = new Float64Array(trace.count);
    let i = 0;
    trace.chunks.forEach((chunk) => { values.set(chunk, i); i += chunk.length; });
    const { chunks, ...rest } = trace;
    return {
      ...rest,
      values,
      // The time axis the analysis pages want, in seconds from the start of
      // the trace: they take a series, not a stream of timestamps.
      seconds: trace.sampleRate
        ? Array.from({ length: values.length }, (_, k) => k / trace.sampleRate)
        : null,
      durationS: trace.sampleRate ? values.length / trace.sampleRate : null,
    };
  });
  return { traces: out, records, problems };
}
