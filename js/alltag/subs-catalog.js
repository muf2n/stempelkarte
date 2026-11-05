// Eingebauter Abo-Katalog (Österreich): Was ist es, Standard-Intervall, Kündigungs-/Verwaltungslink, Schritte.
// Reine Daten + Suche, ohne DOM (auch von tools/mcp benutzt). Tests: test/subs.test.mjs
//
// Links: nur offizielle Seiten der Anbieter, im November 2026 geprüft.
//   verified: true  = Seite aufgerufen und Inhalt bestätigt
//             "suche" = offizielle Seite in der Websuche gefunden, Inhalt nicht abrufbar (z. B. nur mit JavaScript)
// Preise stehen bewusst NICHT drin (ändern sich zu oft) – der Nutzer trägt seinen echten Betrag ein.
// Bei Mobilfunk/Internet/Fitness gilt die Frist laut EIGENEM Vertrag – im Text steht nur „meist“.

const APPLE_SUBS = "https://account.apple.com/account/manage/section/subscriptions";
const APPLE_HELP = "https://support.apple.com/118428";
const PLAY_SUBS = "https://play.google.com/store/account/subscriptions";
const MS_SERVICES = "https://account.microsoft.com/services";
const STORE_HINT = "Hast du über Google Play (Android) oder den App Store (iPhone) abgeschlossen, kündigst du dort: Play Store → Profilbild → Zahlungen & Abos → Abos.";
const TELCO_NOTICE = "meist 1 Monat (Vertrag prüfen)";
const TELCO_HINT = "Kündigungsfrist meist 1 Monat, oft schriftlich – die genaue Frist und eine eventuelle Mindestvertragsdauer (Bindung) stehen in deinem Vertrag. Rufnummer mitnehmen? Dann NICHT selbst kündigen, sondern beim neuen Anbieter die Rufnummernmitnahme beantragen – der alte Vertrag endet dann automatisch.";

/** @type {Array<{key:string,name:string,aliases:string[],emoji:string,what:string,interval:string,cancelUrl:string,manageUrl?:string,helpUrl?:string,cancelHow:string,contractType?:string,noticeText?:string,category?:string,verified:true|"suche"}>} */
export const CATALOG = [
  {
    key: "netflix", name: "Netflix", aliases: ["netflix"], emoji: "🎬", category: "abos",
    what: "Film- & Serien-Streaming", interval: "month",
    cancelUrl: "https://www.netflix.com/cancelplan", manageUrl: "https://www.netflix.com/account", helpUrl: "https://help.netflix.com/de/node/407",
    cancelHow: "1. netflix.com/cancelplan öffnen (ggf. anmelden).\n2. „Kündigen“ tippen.\n3. „Kündigung abschließen“ bestätigen.\nDu kannst bis zum Ende des bezahlten Zeitraums weiterschauen. App löschen oder abmelden kündigt NICHT.",
    verified: true,
  },
  {
    key: "spotify", name: "Spotify", aliases: ["spotify", "spotify premium"], emoji: "🎧", category: "abos",
    what: "Musik-Streaming Premium", interval: "month",
    cancelUrl: "https://www.spotify.com/account/subscription/manage/", manageUrl: "https://www.spotify.com/account/", helpUrl: "https://support.spotify.com/de/article/how-to-cancel-your-subscription/",
    cancelHow: "1. spotify.com/account/subscription/manage öffnen und anmelden.\n2. „Abo kündigen“ wählen und bestätigen.\nPremium läuft bis zum nächsten Rechnungsdatum, danach Spotify Free. In der App geht das Kündigen nicht.",
    verified: true,
  },
  {
    key: "disney", name: "Disney+", aliases: ["disney+", "disney plus", "disneyplus", "disney"], emoji: "🏰", category: "abos",
    what: "Streaming (Disney, Pixar, Marvel, Star Wars)", interval: "month",
    cancelUrl: "https://help.disneyplus.com/de/article/disneyplus-cancel", manageUrl: "https://www.disneyplus.com/de-de/commerce/change-subscription",
    cancelHow: "Im Browser auf disneyplus.com anmelden → Profilbild → Konto → dein Abo antippen → „Abo kündigen“ → bestätigen.\nDer Link oben führt zur offiziellen Disney+-Hilfe mit der aktuellen Anleitung.\n" + STORE_HINT,
    verified: "suche",
  },
  {
    key: "youtube", name: "YouTube Premium", aliases: ["youtube premium", "youtube music", "yt premium", "youtube"], emoji: "▶️", category: "abos",
    what: "YouTube ohne Werbung + YouTube Music", interval: "month",
    cancelUrl: "https://www.youtube.com/paid_memberships", helpUrl: "https://support.google.com/youtube/answer/6308278?hl=de",
    cancelHow: "1. youtube.com/paid_memberships öffnen (mit dem richtigen Google-Konto).\n2. Bei YouTube Premium auf „Mitgliedschaft deaktivieren“ / „Kündigen“ tippen und bestätigen.\nÜber das iPhone abgeschlossen? Dann über die Apple-Abos kündigen.",
    verified: true,
  },
  {
    key: "prime", name: "Amazon Prime", aliases: ["amazon prime", "prime video", "prime", "amazon"], emoji: "📦", category: "abos",
    what: "Versand, Prime Video & Musik", interval: "month",
    cancelUrl: "https://www.amazon.de/gp/help/customer/display.html?nodeId=GTJQ7QZY7QL2HK4Y",
    cancelHow: "Auf amazon.de anmelden → „Konto und Listen“ → „Prime-Mitgliedschaft“ → „Mitgliedschaft verwalten“ → „Mitgliedschaft beenden“ und alle Seiten bis zur Bestätigung durchklicken.\nDer Link führt zur offiziellen Amazon-Hilfe „Prime-Mitgliedschaft kündigen“.",
    verified: "suche",
  },
  {
    key: "audible", name: "Audible", aliases: ["audible"], emoji: "📚", category: "abos",
    what: "Hörbuch-Abo", interval: "month",
    cancelUrl: "https://www.audible.de/", helpUrl: "https://www.audible.de/kontakt",
    cancelHow: "Im Browser (nicht in der App) auf audible.de anmelden → Name/Konto → „Kontodetails“ → „Abo kündigen“.\nVorher Guthaben einlösen – offenes Guthaben verfällt meist mit der Kündigung.\nKein direkter Kündigungslink gefunden – Link führt zu audible.de, Hilfe unter audible.de/kontakt.",
    verified: "suche",
  },
  {
    key: "apple", name: "Apple (Abos verwalten)", aliases: ["apple", "app store", "apple abo", "apple id", "itunes"], emoji: "🍎", category: "abos",
    what: "Abos über die Apple-ID (App Store)", interval: "month",
    cancelUrl: APPLE_SUBS, helpUrl: APPLE_HELP,
    cancelHow: "iPhone: Einstellungen → dein Name → Abonnements → Abo antippen → „Abo kündigen“.\nIm Web: account.apple.com/account/manage/section/subscriptions → anmelden → Abo kündigen.\nTestzeitraum: mindestens 24 Stunden vor Ende kündigen.",
    verified: true,
  },
  {
    key: "icloud", name: "iCloud+", aliases: ["icloud", "icloud+", "icloud plus", "icloud speicher"], emoji: "☁️", category: "abos",
    what: "Apple Cloud-Speicher", interval: "month",
    cancelUrl: APPLE_SUBS, helpUrl: APPLE_HELP,
    cancelHow: "iPhone: Einstellungen → dein Name → iCloud → Speicher verwalten / „Speicherplan ändern“ → „Downgrade-Optionen“ → Gratis 5 GB wählen.\nOder: Einstellungen → dein Name → Abonnements → iCloud+ → kündigen.\nVorher prüfen, dass deine Fotos/Backups in 5 GB passen.",
    verified: true,
  },
  {
    key: "applemusic", name: "Apple Music", aliases: ["apple music"], emoji: "🎵", category: "abos",
    what: "Musik-Streaming von Apple", interval: "month",
    cancelUrl: APPLE_SUBS, helpUrl: APPLE_HELP,
    cancelHow: "iPhone: Einstellungen → dein Name → Abonnements → Apple Music → „Abo kündigen“.\nAndroid: Apple-Music-App → Einstellungen → Abo verwalten → Kündigen.\nIm Web: account.apple.com → Abonnements.",
    verified: true,
  },
  {
    key: "googleplay", name: "Google Play Abos", aliases: ["google play", "play store", "googleplay"], emoji: "🛍️", category: "abos",
    what: "Abos über den Play Store (Android)", interval: "month",
    cancelUrl: PLAY_SUBS, helpUrl: "https://support.google.com/googleplay/answer/7018481?hl=de",
    cancelHow: "1. play.google.com/store/account/subscriptions öffnen (oder Play Store → Profilbild → Zahlungen & Abos → Abos).\n2. Abo auswählen → „Abo kündigen“ → Anweisungen folgen.\nApp deinstallieren kündigt NICHT. Du kannst bis zum Ende des bezahlten Zeitraums weiter nutzen.",
    verified: true,
  },
  {
    key: "googleone", name: "Google One", aliases: ["google one", "google speicher", "google ai pro"], emoji: "🗂️", category: "abos",
    what: "Google-Speicher (Drive, Gmail, Fotos)", interval: "month",
    cancelUrl: "https://one.google.com/", helpUrl: "https://support.google.com/googleone/answer/9056360?hl=de",
    cancelHow: "1. one.google.com öffnen.\n2. Einstellungen (Zahnrad) → „Abo kündigen“.\n3. Nochmals „Abo kündigen“ bestätigen.\nÜber Google Play gekauft? Dann im Play Store unter Abos kündigen.",
    verified: true,
  },
  {
    key: "m365", name: "Microsoft 365", aliases: ["microsoft 365", "office 365", "office", "m365", "onedrive"], emoji: "🪟", category: "abos",
    what: "Word, Excel, Outlook & 1 TB OneDrive", interval: "year",
    cancelUrl: MS_SERVICES, helpUrl: "https://support.microsoft.com/de-de/accounts-billing/subscriptions/cancel-your-microsoft-subscription",
    cancelHow: "1. account.microsoft.com/services öffnen und mit dem Microsoft-Konto anmelden.\n2. Beim Abo „Verwalten“ → „Kündigen“ (manchmal „Upgrade oder Kündigen“).\n3. Anweisungen folgen.\nSteht dort „Wiederkehrende Abrechnung aktivieren“, ist es schon gekündigt.",
    verified: true,
  },
  {
    key: "gamepass", name: "Xbox Game Pass", aliases: ["xbox game pass", "game pass", "gamepass", "xbox"], emoji: "🎮", category: "abos",
    what: "Spiele-Abo für Xbox & PC", interval: "month",
    cancelUrl: MS_SERVICES, helpUrl: "https://support.xbox.com/en-SG/help/subscriptions-billing/manage-subscriptions/cancel-recurring-billing-or-subscription",
    cancelHow: "1. account.microsoft.com/services öffnen (Microsoft-Konto der Xbox).\n2. Bei Game Pass „Verwalten“ → „Abonnement kündigen“ / „Wiederkehrende Abrechnung deaktivieren“.\n3. Bestätigen. Du kannst bis zum Ende des bezahlten Zeitraums spielen.",
    verified: true,
  },
  {
    key: "psplus", name: "PlayStation Plus", aliases: ["playstation plus", "ps plus", "ps+", "psplus", "playstation"], emoji: "🕹️", category: "abos",
    what: "Online-Spielen & Spielekatalog für PS4/PS5", interval: "month",
    cancelUrl: "https://www.playstation.com/acct/management", helpUrl: "https://www.playstation.com/en-us/support/subscriptions/cancel-playstation-plus/",
    cancelHow: "1. playstation.com/acct/management öffnen und anmelden.\n2. Links „Abonnement“ wählen.\n3. Neben PlayStation Plus „Abonnement kündigen“.\nAuf der PS5: Einstellungen → Benutzer und Konten → Konto → Zahlung und Abonnements → Abonnements.",
    verified: true,
  },
  {
    key: "nintendo", name: "Nintendo Switch Online", aliases: ["nintendo switch online", "nintendo online", "switch online", "nintendo"], emoji: "🍄", category: "abos",
    what: "Online-Spielen & Klassiker für die Switch", interval: "year",
    cancelUrl: "https://accounts.nintendo.com/portal", helpUrl: "https://www.nintendo.com/de-at/Support/Nintendo-Switch/Nintendo-Switch-Online/Kann-ich-meine-Nintendo-Switch-Online-Mitgliedschaft-kundigen-1441172.html",
    cancelHow: "Web: accounts.nintendo.com/portal → anmelden → Nintendo Switch Online → bei „Gültige Mitgliedschaften“ die Mitgliedschaft wählen → „Automatische Verlängerungen deaktivieren“ → bestätigen.\nKonsole: Nintendo eShop → Profilbild oben rechts → „Automatische Verlängerungen deaktivieren“.\nDie Mitgliedschaft läuft bis zum Ende, verlängert sich aber nicht mehr.",
    verified: true,
  },
  {
    key: "dazn", name: "DAZN", aliases: ["dazn"], emoji: "⚽", category: "abos",
    what: "Sport-Streaming", interval: "month",
    cancelUrl: "https://help.dazn.com/hc/en-gb/articles/16194539395613-How-do-I-cancel-my-subscription",
    cancelHow: "DAZN-App oder dazn.com: Profil-Symbol oben rechts → „Mein Konto“ → ganz unten „Abo kündigen“ → „Weiter“ → Grund wählen → Angebote ablehnen („Nein danke“) → Passwort eingeben.\nBeim Jahresabo (monatlich bezahlt) endet es erst nach der Jahreslaufzeit. Link = offizielle DAZN-Hilfe.",
    verified: true,
  },
  {
    key: "wow", name: "WOW (Sky)", aliases: ["wow", "wow tv", "wowtv", "sky", "sky x", "sky ticket", "sky österreich"], emoji: "📡", category: "abos",
    what: "Serien, Filme & Live-Sport von Sky", interval: "month",
    cancelUrl: "https://www.wowtv.de/konto/abo", helpUrl: "https://www.wowtv.de/at/hilfe",
    cancelHow: "Auf wowtv.de anmelden → „Mein Konto“ → „Abos & Zahlungen“ → Abo kündigen.\nMit Mindestlaufzeit (z. B. 12 Monate) endet es erst zum Ende der Laufzeit.\nHinweis: Der Kontolink stammt aus der deutschen WOW-Hilfe; Hilfe für Österreich unter wowtv.de/at/hilfe. Klassisches Sky-Abo (Receiver): über „Mein Sky“ auf sky.at.",
    verified: true,
  },
  {
    key: "crunchyroll", name: "Crunchyroll", aliases: ["crunchyroll"], emoji: "🍥", category: "abos",
    what: "Anime-Streaming Premium", interval: "month",
    cancelUrl: "https://help.crunchyroll.com/hc/en-us/articles/46070271612820-How-can-I-cancel-my-Premium-Membership",
    cancelHow: "Im Browser auf crunchyroll.com anmelden → Profilbild → Einstellungen → „Premium-Mitgliedschaft“ → „Abo kündigen“.\n" + STORE_HINT + "\nLink = offizielle Crunchyroll-Hilfe.",
    verified: "suche",
  },
  {
    key: "twitch", name: "Twitch", aliases: ["twitch", "twitch turbo", "twitch sub"], emoji: "💜", category: "abos",
    what: "Kanal-Abo / Turbo", interval: "month",
    cancelUrl: "https://help.twitch.tv/s/article/purchase-support-faq", helpUrl: "https://help.twitch.tv/s/article/subscriptions-on-mobile",
    cancelHow: "twitch.tv im Browser → Profilbild → „Abonnements“ → beim Kanal auf das Zahnrad/„…“ → „Nicht verlängern“.\nÜber die Handy-App abgeschlossen? Dann im Play Store bzw. App Store kündigen.\nKein direkter Link geprüft – Link führt zur offiziellen Twitch-Hilfe.",
    verified: "suche",
  },
  {
    key: "nitro", name: "Discord Nitro", aliases: ["discord nitro", "nitro", "discord"], emoji: "💬", category: "abos",
    what: "Discord-Extras (Emojis, Uploads, HD-Stream)", interval: "month",
    cancelUrl: "https://support.discord.com/hc/en-us/articles/19580873036695-How-to-Cancel-your-Nitro-Subscription",
    cancelHow: "Discord → Benutzereinstellungen (Zahnrad) → „Abonnements“ → „Abonnement kündigen“ → bestätigen.\nÜber Google Play/App Store gekauft? Dort kündigen.\nLink = offizielle Discord-Hilfe.",
    verified: "suche",
  },
  {
    key: "snapchat", name: "Snapchat+", aliases: ["snapchat+", "snapchat plus", "snapchat", "snap+"], emoji: "👻", category: "abos",
    what: "Snapchat-Extras", interval: "month",
    cancelUrl: "https://accounts.snapchat.com/v2/my-subscription", helpUrl: "https://help.snapchat.com/hc/en-us/articles/8098571884948-How-do-I-cancel-my-subscription-to-Snapchat-or-Memories",
    cancelHow: "Android: über Google Play → Abos kündigen.\niPhone: über die Apple-Abos kündigen.\nIm Web abgeschlossen: accounts.snapchat.com/v2/my-subscription.",
    verified: true,
  },
  {
    key: "chatgpt", name: "ChatGPT Plus", aliases: ["chatgpt", "chatgpt plus", "openai", "chat gpt"], emoji: "🤖", category: "abos",
    what: "KI-Assistent von OpenAI", interval: "month",
    cancelUrl: "https://help.openai.com/en/articles/7232927-canceling-your-chatgpt-subscription",
    cancelHow: "chatgpt.com im Browser → Profilbild → „Einstellungen“ → „Konto“ bzw. „Abo“ → „Verwalten“ → „Abo kündigen“.\nIn der Android-App gekauft? Dann im Play Store kündigen.\nLink = offizielle OpenAI-Hilfe.",
    verified: "suche",
  },
  {
    key: "claude", name: "Claude Pro", aliases: ["claude", "claude pro", "claude max", "anthropic"], emoji: "✳️", category: "abos",
    what: "KI-Assistent von Anthropic", interval: "month",
    cancelUrl: "https://claude.ai/settings/billing", helpUrl: "https://support.claude.com/en/articles/8325617-cancel-your-pro-max-or-ultra-subscription",
    cancelHow: "1. claude.ai/settings/billing öffnen (Einstellungen → Abrechnung).\n2. „Kündigen“ klicken.\nDas Abo läuft bis zum Ende des bezahlten Zeitraums – mindestens 24 Stunden vor der nächsten Abbuchung kündigen.\nÜber die App gekauft? Dann im Play Store/App Store.",
    verified: true,
  },
  {
    key: "duolingo", name: "Duolingo Super", aliases: ["duolingo", "duolingo super", "super duolingo", "duolingo max"], emoji: "🦉", category: "schule",
    what: "Sprachen lernen ohne Werbung", interval: "year",
    cancelUrl: "https://www.duolingo.com/help/cancel-my-super-duolingo-subscription",
    cancelHow: "Gekündigt wird dort, wo du gekauft hast: Android → Play Store → Abos → Duolingo → Kündigen; iPhone → Apple-Abos.\nIm Web gekauft: duolingo.com → Einstellungen → Super Duolingo → Abo kündigen.\nLink = offizielle Duolingo-Hilfe.",
    verified: "suche",
  },
  {
    key: "tinder", name: "Tinder", aliases: ["tinder", "tinder gold", "tinder plus", "tinder platinum"], emoji: "🔥", category: "freizeit",
    what: "Dating-App (Plus/Gold/Platinum)", interval: "month",
    cancelUrl: "https://www.help.tinder.com/hc/en-us/articles/115003554466-Cancel-your-subscription",
    cancelHow: "Android: Play Store → Abos → Tinder → Kündigen.\niPhone: Apple-Abos → Tinder → Kündigen.\nIm Web gekauft: tinder.com → Profil → Einstellungen → Zahlungskonto verwalten → Mitgliedschaft kündigen.\nKonto löschen kündigt das Abo NICHT. Link = offizielle Tinder-Hilfe.",
    verified: "suche",
  },
  {
    key: "mcfit", name: "McFit", aliases: ["mcfit", "mc fit"], emoji: "🏋️", category: "freizeit",
    what: "Fitnessstudio-Mitgliedschaft", interval: "month", contractType: "Mindestlaufzeit",
    cancelUrl: "https://www.mcfit.com/at/kuendigung/", helpUrl: "https://hilfe-at.mcfit.com/hc/de-at/articles/40634472952337-Wie-kann-ich-meine-McFIT-Mitgliedschaft-beenden",
    cancelHow: "Online über die Kündigungsseite von McFIT Österreich (Link) oder laut Hilfe-Artikel.\nFrist und Mindestlaufzeit stehen in deinem Vertrag – Kündigungsbestätigung aufheben!\nLinks = offizielle McFIT-Seiten (Inhalt nicht geprüft, Seite lädt nur mit JavaScript).",
    noticeText: "laut Vertrag", verified: "suche",
  },
  {
    key: "fitinn", name: "FitInn", aliases: ["fitinn", "fit inn", "fitinn.at"], emoji: "💪", category: "freizeit",
    what: "Fitnessstudio-Mitgliedschaft", interval: "month", contractType: "Mindestlaufzeit",
    cancelUrl: "https://my.fitinn.at/", helpUrl: "https://fitinn.at/faq/",
    cancelHow: "Online im Mitgliederbereich myFITINN (my.fitinn.at) oder in jedem FITINN-Studio.\nLaut FITINN-FAQ: 12 Monate Mindestlaufzeit, danach mit 1 Monat Frist zum Monatsende kündbar (gilt für Standard-Abos – deinen Vertrag prüfen).",
    noticeText: "1 Monat zum Monatsende", verified: true,
  },
  {
    key: "cleverfit", name: "clever fit", aliases: ["clever fit", "cleverfit", "clever-fit"], emoji: "🏃", category: "freizeit",
    what: "Fitnessstudio-Mitgliedschaft", interval: "month", contractType: "Mindestlaufzeit",
    cancelUrl: "https://www.clever-fit.com/de-AT/vertragskuendigung/",
    cancelHow: "Online über die Seite „Vertragskündigung“ von clever fit Österreich (Link) oder direkt in deinem Studio.\nFrist und Mindestlaufzeit laut deinem Vertrag – Bestätigung aufheben.",
    noticeText: "laut Vertrag", verified: true,
  },
  {
    key: "a1", name: "A1", aliases: ["a1", "a1 telekom", "a1 mobil", "a1 internet"], emoji: "📶", category: "handy",
    what: "Handy-/Internet-Vertrag", interval: "month", contractType: "Mindestlaufzeit",
    cancelUrl: "https://www.a1.net/kuendigen", helpUrl: "https://www.a1.net/faq/telefonie/vertrag/vertrag-kuendigen",
    cancelHow: "Kündigungsseite von A1 (Link) – oder über das A1 Service Team (a1.net/kontakt) bzw. im A1 Shop.\n" + TELCO_HINT,
    noticeText: TELCO_NOTICE, verified: true,
  },
  {
    key: "magenta", name: "Magenta", aliases: ["magenta", "magenta telekom", "t-mobile", "tmobile", "upc"], emoji: "📱", category: "handy",
    what: "Handy-/Internet-/TV-Vertrag", interval: "month", contractType: "Mindestlaufzeit",
    cancelUrl: "https://www.magenta.at/kuendigung", helpUrl: "https://www.magenta.at/hilfe-service/services/kontaktformular/onlinekuendigen",
    cancelHow: "Laut Magenta: über die Hotline 0800 676 712 (Mo–Fr 8–18 Uhr), den Rückrufservice, die Mein-Magenta-App oder im Shop. Das Online-Formular gilt nur für Umzug ins Ausland/Sterbefall.\nMagenta nennt 1 Monat Frist ab Eingang. Bindefrist siehst du in Mein Magenta unter Vertragsdetails.\n" + TELCO_HINT,
    noticeText: TELCO_NOTICE, verified: true,
  },
  {
    key: "drei", name: "Drei", aliases: ["drei", "hutchison drei", "drei.at"], emoji: "3️⃣", category: "handy",
    what: "Handy-/Internet-Vertrag", interval: "month", contractType: "Mindestlaufzeit",
    cancelUrl: "https://www.drei.at/de/hilfe/vertrag/kuendigung/wie-vertrag-kuendigen.html",
    cancelHow: "Laut Drei: Nachricht an das Service-Team, per Post oder im Drei Shop. Du brauchst dein Kundenkennwort.\n" + TELCO_HINT,
    noticeText: TELCO_NOTICE, verified: true,
  },
  {
    key: "hot", name: "HoT", aliases: ["hot", "hofer telekom", "hot.at", "hot mobil"], emoji: "🔶", category: "handy",
    what: "Handytarif (Hofer Telekom)", interval: "month",
    cancelUrl: "https://www.hot.at/kontakt/", helpUrl: "https://www.hot.at/agb/",
    cancelHow: "Kündigung über den HoT-Kundenservice (Kontaktseite, Service Team 0677 6001 6770).\nKeine eigene Online-Kündigungsseite gefunden – Frist laut AGB/Tarif prüfen.\nRufnummer mitnehmen? Dann beim neuen Anbieter die Rufnummernmitnahme beantragen.",
    noticeText: TELCO_NOTICE, verified: true,
  },
  {
    key: "spusu", name: "spusu", aliases: ["spusu"], emoji: "🐝", category: "handy",
    what: "Handytarif", interval: "month",
    cancelUrl: "https://www.spusu.at/files?f=K%C3%BCndigungsformular.pdf", manageUrl: "https://www.spusu.at/",
    cancelHow: "Kündigungsformular (PDF, Link) ausfüllen, unterschreiben und an spusu schicken – Adresse/E-Mail steht im Formular.\nFrist laut AGB/Tarif prüfen.\nRufnummer mitnehmen? Dann beim neuen Anbieter die Rufnummernmitnahme beantragen.",
    noticeText: TELCO_NOTICE, verified: "suche",
  },
  {
    key: "yesss", name: "yesss!", aliases: ["yesss", "yesss!"], emoji: "✅", category: "handy",
    what: "Handytarif (Wertkarte/Vertrag)", interval: "month",
    cancelUrl: "https://www.yesss.at/fragen/tarif-verwalten", helpUrl: "https://www.yesss.at/kontakt",
    cancelHow: "Laut yesss!: Vertrag jederzeit mit 1 Monat Frist kündbar – mit datiertem, unterschriebenem Kündigungsschreiben per E-Mail an info@yesss.at oder per Post an yesss!, Postfach 0699, 1010 Wien.\nJahrestarif: Kündigung wirkt erst nach Ablauf des Jahres.\nWertkarte: einfach nicht mehr aufladen.",
    noticeText: "1 Monat", verified: true,
  },
  {
    key: "oeamtc", name: "ÖAMTC", aliases: ["öamtc", "oeamtc", "oamtc"], emoji: "🚗", category: "auto",
    what: "Mitgliedschaft (Pannenhilfe, Schutzbrief)", interval: "year", contractType: "Mindestlaufzeit",
    cancelUrl: "https://www.oeamtc.at/kontakt/statuten-des-oeamtc-16806761",
    cancelHow: "Laut ÖAMTC-Statuten: Austritt schriftlich (E-Mail zählt) bis spätestens 31. Oktober – die Mitgliedschaft endet dann mit Jahresende.\nMitgliedsnummer angeben, Bestätigung aufheben. Link = Statuten des ÖAMTC (Kontakt über oeamtc.at).",
    noticeText: "2 Monate zum Monatsende", verified: true,
  },
];

/* ---------- Suche ---------- */

/** Name vereinfachen: Kleinbuchstaben, Umlaute, nur a–z/0–9, „+“ → „plus“. */
export function catNorm(s) {
  return String(s ?? "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/\+/g, " plus ").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Passenden Katalog-Eintrag zu einem Abo-Namen finden (unscharf).
 * „Netflix Standard“ → Netflix, „Spotfiy“ → Spotify, „Disney Plus“ → Disney+, „Handy A1“ → A1.
 * Kurze Kürzel (≤ 3 Zeichen wie „a1“, „hot“, „3“) nur als ganzes Wort.
 * → { entry, score } | null
 */
export function matchCatalog(name, catalog = CATALOG) {
  const q = catNorm(name);
  if (!q) return null;
  const qc = q.replace(/ /g, "");
  const words = q.split(" ");
  let best = null;
  const take = (entry, score) => { if (!best || score > best.score) best = { entry, score }; };
  for (const e of catalog) {
    for (const al of [e.name, ...(e.aliases || [])]) {
      const a = catNorm(al);
      if (!a) continue;
      const ac = a.replace(/ /g, "");
      if (q === a || qc === ac) { take(e, 100 + ac.length); continue; }
      if (ac.length <= 3) {
        if (a.split(" ").length === 1 && words.includes(a)) take(e, 60 + ac.length);
        continue;
      }
      // ganzes Alias-Wort/-Phrase im Namen („Netflix Standard“, „Mein Spotify“)
      if ((" " + q + " ").includes(" " + a + " ")) { take(e, 80 + ac.length); continue; }
      if (qc.includes(ac) && ac.length >= 5) { take(e, 70 + ac.length); continue; }
      // Tippfehler: ein Wort ähnlich genug
      for (const w of words) {
        if (w.length >= 5 && ac.length >= 5 && Math.abs(w.length - ac.length) <= 2 && lev(w, ac) <= (ac.length >= 6 ? 2 : 1)) take(e, 50 + ac.length);
      }
    }
  }
  return best;
}

export const catalogByKey = (k) => CATALOG.find((e) => e.key === k) || null;

/**
 * Felder aus dem Katalog, die ein Abo noch NICHT hat (nichts Vorhandenes wird überschrieben).
 * opts.interval: auch das Intervall übernehmen (nur bei neuen Abos sinnvoll).
 */
export function catalogFill(sub, entry, { interval = false } = {}) {
  if (!entry) return {};
  const s = sub || {};
  const out = {};
  const empty = (v) => v == null || String(v).trim() === "";
  if (empty(s.what)) out.what = entry.what;
  if (empty(s.cancelUrl)) out.cancelUrl = entry.cancelUrl;
  if (empty(s.manageUrl) && (entry.manageUrl || entry.helpUrl)) out.manageUrl = entry.manageUrl || entry.helpUrl;
  if (empty(s.cancelHow)) out.cancelHow = entry.cancelHow;
  if (empty(s.noticeText) && entry.noticeText && entry.noticeText !== "laut Vertrag") out.noticeText = entry.noticeText;
  if (interval && entry.interval) out.interval = entry.interval;
  if (interval && empty(s.contractType) && entry.contractType) out.contractType = entry.contractType;
  out.catalogKey = entry.key;
  return out;
}
