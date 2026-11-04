// node --test test/voice-core.test.mjs
// Sprachmodus des Claude-Assistenten: Vorlesetext, Weckwort, Stopp-Wörter, Stimmenwahl.
import test from "node:test";
import assert from "node:assert/strict";
import { speakable, matchWake, isStopPhrase, rankVoices, pickVoice, splitChunks, normVoice, sanitizeName, nameMatches, lev } from "../js/alltag/voice-core.js";

test("speakable: Dauer „4:30 h“ → Stunden und Minuten", () => {
  assert.equal(speakable("Du hast 4:30 h Überstunden."), "Du hast 4 Stunden 30 Minuten Überstunden.");
  assert.equal(speakable("Saldo +2:15 h"), "Saldo plus 2 Stunden 15 Minuten.");
  assert.equal(speakable("Saldo −1:00 h"), "Saldo minus 1 Stunde.");
  assert.equal(speakable("Noch 0:45 h"), "Noch 45 Minuten.");
  assert.equal(speakable("Soll 38,5 h pro Woche"), "Soll 38,5 Stunden pro Woche.");
  assert.equal(speakable("1 h Pause, dann 30 min Fahrt"), "1 Stunde Pause, dann 30 Minuten Fahrt.");
  assert.equal(speakable("12:05 Std."), "12 Stunden 5 Minuten.");
});

test("speakable: Euro-Beträge", () => {
  assert.equal(speakable("Ausgaben: 1.234,56 €"), "Ausgaben: 1234 Euro 56.");
  assert.equal(speakable("Max schuldet dir 12,50 €"), "Max schuldet dir 12 Euro 50.");
  assert.equal(speakable("Das kostet 5,00 €"), "Das kostet 5 Euro.");
  assert.equal(speakable("Nur 0,50 €"), "Nur 50 Cent.");
  assert.equal(speakable("Saldo -12,50 €"), "Saldo minus 12 Euro 50.");
  assert.equal(speakable("€ 9,90 für Spotify"), "9 Euro 90 für Spotify.");
  assert.equal(speakable("Budget 3,00 $"), "Budget 3 Dollar.");
  assert.equal(speakable("zwischen 3–5 €"), "zwischen 3–5 Euro.");
});

test("speakable: Uhrzeiten und Datum", () => {
  assert.equal(speakable("Morgen um 7:00 Uhr Baustelle"), "Morgen um 7 Uhr Baustelle.");
  assert.equal(speakable("Eingestempelt um 14:05"), "Eingestempelt um 14 Uhr 5.");
  assert.equal(speakable("Arbeit 7:00–15:30"), "Arbeit 7 Uhr bis 15 Uhr 30.");
  assert.equal(speakable("Prüfung am 05.11.2026"), "Prüfung am 5. November 2026.");
  assert.equal(speakable("Urlaub ab 2.1."), "Urlaub ab 2. Jänner.");
  assert.equal(speakable("Mo, 03.03.2025: Schule"), "Montag, 3. März 2025: Schule.");
  assert.equal(speakable("Version 40.13.2026"), "Version 40.13.2026.");
});

test("speakable: Markdown weg, Aufzählungen werden kurze Sätze", () => {
  const md = "**Diese Woche:**\n- Mo: Schule\n- Di: Baustelle *Huber*\n1. Prüfung Mathe\n\n## Tipp\nLies [das](https://x.at) ✓ 🎉";
  assert.equal(speakable(md), "Diese Woche. Mo: Schule. Di: Baustelle Huber. Prüfung Mathe. Tipp. Lies das.");
  assert.equal(speakable("`code` und __fett__"), "code und fett.");
  assert.equal(speakable("z. B. 80 % ≈ 23 km"), "zum Beispiel 80 Prozent ungefähr 23 Kilometer.");
  assert.equal(speakable("Fertig!"), "Fertig!");
  assert.equal(speakable(""), "");
  assert.equal(speakable(null), "");
});

test("splitChunks: lange Texte an Satzgrenzen zerlegen", () => {
  assert.deepEqual(splitChunks("Eins. Zwei! Drei?", 10), ["Eins.", "Zwei!", "Drei?"]);
  assert.deepEqual(splitChunks("Eins. Zwei.", 100), ["Eins. Zwei."]);
  const long = "a".repeat(50) + ", " + "b".repeat(50) + ".";
  const parts = splitChunks(long, 60);
  assert.ok(parts.length === 2 && parts.every((p) => p.length <= 60), JSON.stringify(parts));
  assert.deepEqual(splitChunks(""), []);
});

test("matchWake: Weckwort mit Rest des Satzes", () => {
  assert.deepEqual(matchWake("Hey Claude, wie viele Überstunden hab ich?"), { rest: "Wie viele Überstunden hab ich?" });
  assert.deepEqual(matchWake("hallo claude was steht morgen an"), { rest: "Was steht morgen an" });
  assert.deepEqual(matchWake("OK Claude"), { rest: "" });
  assert.deepEqual(matchWake("okay claude."), { rest: "" });
  assert.deepEqual(matchWake("hey cloud plan meinen Tag"), { rest: "Plan meinen Tag" });
  assert.deepEqual(matchWake("Hey Klaud!"), { rest: "" });
  assert.deepEqual(matchWake("ähm hey klaut wie spät ist es"), { rest: "Wie spät ist es" });
  assert.equal(matchWake("ich hab heute Claude gefragt"), null);
  assert.equal(matchWake("hey claudia"), null);
  assert.equal(matchWake("die cloud ist voll"), null);
  assert.equal(matchWake("Okay, das ist gut"), null);
  assert.equal(matchWake(""), null);
});

test("isStopPhrase: nur ganze Stopp-Äußerungen", () => {
  for (const t of ["Stopp", "stop", "Danke", "Danke schön!", "Tschüss", "tschüs", "ok danke", "Passt, danke", "Danke Claude", "Baba", "Das war's", "hör auf", "Nein danke"]) {
    assert.equal(isStopPhrase(t), true, t);
  }
  for (const t of ["Danke, und wie viele Überstunden?", "Stopp die Zeit um 15 Uhr", "Wie sagt man tschüss auf Englisch", "", "Ende der Woche Urlaub"]) {
    assert.equal(isStopPhrase(t), false, t);
  }
});

test("rankVoices/pickVoice: deutsche Stimmen, natürliche bzw. Google zuerst", () => {
  const voices = [
    { name: "Microsoft Hedda", lang: "de-DE", voiceURI: "hedda" },
    { name: "Samantha", lang: "en-US", voiceURI: "sam" },
    { name: "Google Deutsch", lang: "de-DE", voiceURI: "gde" },
    { name: "Anna (de-AT)", lang: "de-AT", voiceURI: "anna" },
    { name: "Microsoft Katja Online (Natural) - German (Germany)", lang: "de-DE", voiceURI: "katja" },
    { name: "eSpeak German", lang: "de", voiceURI: "esp" },
  ];
  const r = rankVoices(voices).map((v) => v.voiceURI);
  assert.deepEqual(r, ["katja", "gde", "anna", "hedda", "esp"]);
  assert.equal(pickVoice(voices, "").voiceURI, "katja");
  assert.equal(pickVoice(voices, "anna").voiceURI, "anna");
  assert.equal(pickVoice(voices, "weg").voiceURI, "katja");
  assert.equal(pickVoice([{ name: "x", lang: "en-GB" }]), null);
  assert.equal(pickVoice([]), null);
});

test("normVoice: Grenzen und Standardwerte", () => {
  assert.deepEqual(normVoice(null), { voiceURI: "", rate: 1.05, pitch: 1, readAloud: false, short: true, wake: false, wakeGranted: false });
  const v = normVoice({ rate: 9, pitch: "0.1", readAloud: true, short: false, wake: true, voiceURI: 5 });
  assert.equal(v.rate, 1.6); assert.equal(v.pitch, 0.5); assert.equal(v.readAloud, true); assert.equal(v.short, false);
  assert.equal(v.wake, true); assert.equal(v.voiceURI, "");
});

test("eigener Name: Weckwort „hey Jarvis“", () => {
  assert.deepEqual(matchWake("hey jarvis", "Jarvis"), { rest: "" });
  assert.deepEqual(matchWake("Hey Jarvis, wie viele Überstunden hab ich?", "Jarvis"), { rest: "Wie viele Überstunden hab ich?" });
  assert.deepEqual(matchWake("hey jarvis wie viele", "Jarvis"), { rest: "Wie viele" });
  assert.deepEqual(matchWake("OK Jarwis was steht an", "Jarvis"), { rest: "Was steht an" }, "Lautform w/v");
  assert.deepEqual(matchWake("hallo jervis", "Jarvis"), { rest: "" }, "Abstand 1");
  assert.equal(matchWake("hey service", "Jarvis"), null);
  assert.equal(matchWake("hey jars wie spät", "Jarvis"), null);
  assert.equal(matchWake("ich hab Jarvis gefragt", "Jarvis"), null);
  assert.equal(matchWake("hey claude", "Jarvis"), null, "alter Name gilt nicht mehr");
  // kurze Namen: nur genaue Lautform, keine Abstands-Toleranz
  assert.deepEqual(matchWake("hey Max wie geht's", "Max"), { rest: "Wie geht's" });
  assert.equal(matchWake("hey mag", "Max"), null);
  // Umlaute / mehrteilige Namen
  assert.deepEqual(matchWake("hallo jürgen", "Jürgen"), { rest: "" });
  assert.deepEqual(matchWake("hey juergen mach was", "Jürgen"), { rest: "Mach was" });
  assert.deepEqual(matchWake("ok mister x und jetzt", "Mister X"), { rest: "Und jetzt" });
  assert.deepEqual(matchWake("hey cloud", ""), { rest: "" }, "leerer Name → Claude");
});

test("sanitizeName / nameMatches / lev", () => {
  assert.equal(sanitizeName("  Jarvis  "), "Jarvis");
  assert.equal(sanitizeName("J.A.R.V.I.S.!"), "JARVIS");
  assert.equal(sanitizeName("<script>x</script>"), "scriptxscript");
  assert.equal(sanitizeName("Anna-Lena  Maier"), "Anna-Lena Maier");
  assert.equal(sanitizeName("a".repeat(40)).length, 24);
  assert.equal(sanitizeName("123"), "");
  assert.equal(sanitizeName(null), "");
  assert.ok(nameMatches("Jarvis", "jarvis") && nameMatches("klaut", "Claude") && !nameMatches("claudia", "Claude"));
  assert.equal(lev("kitten", "sitting"), 3);
  assert.equal(isStopPhrase("Danke Jarvis", "Jarvis"), true);
  assert.equal(isStopPhrase("Danke Jarvis, und morgen?", "Jarvis"), false);
});
