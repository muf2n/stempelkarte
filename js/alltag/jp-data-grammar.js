// Alltag › Japanisch › 📐 Grammatik: 20 kurze Anfänger-Lektionen (reine Daten).
// Lektion: { id, emoji, title, short, level, explain:[Absatz…], table:[[japanisch, deutsch]…], examples:[[src, romaji, deutsch]…], ex:[Übung…] }
//   examples-src im Kompaktformat von ./jp-text.js ("私{わたし} は / 学生{がくせい} です 。").
// Übungen (Sätze nur in Kana, Leerzeichen zwischen Satzgliedern – so wie in Anfänger-Lehrbüchern):
//   { t:"mc",    s:"わたしは がくせい ＿。", opts:[…], a, ro, de }  Lücke füllen (ro/de = ganzer richtiger Satz)
//   { t:"build", src:"わたし は / パン を / たべます 。", ro, de }    Satz aus Kacheln bauen
//   { t:"pick",  s:"…", ro, a, opts:[deutsch…] }                       Japanisch → richtige Übersetzung wählen
//   { t:"pickja", de, a:"…", ro, opts:[japanisch…] }                   Deutsch → richtigen japanischen Satz wählen
// PATH_ORDER: Reihenfolge im 🛤️ Lernpfad nach Hiragana/Katakana ("w:Thema" Wortschatz, "w+:Thema" Erweiterung, "g:id" Grammatik).
// Geprüft in test/jp-data.test.mjs (Kana ↔ Romaji je Satz, Lösung in den Optionen, Kacheln lösbar).

const G = (id, emoji, title, short, level, explain, table, examples, ex) => ({ id, emoji, title, short, level, explain, table, examples, ex });

export const GRAMMAR = [
  G("desu", "🟰", "です – sein", "A は B です", "N5", [
    "A は B です。 heißt „A ist B“. です steht immer am Satzende und macht den Satz höflich.",
    "Verneinung: じゃないです (gesprochen) oder ではありません (etwas förmlicher). Vergangenheit: でした (war), verneint: じゃなかったです.",
    "Im Japanischen steht das Verb immer am Ende. Es gibt keine Artikel (der/die/das) und meistens keine Mehrzahl.",
  ], [["です", "ist / bin / sind"], ["じゃないです", "ist nicht"], ["ではありません", "ist nicht (förmlicher)"], ["でした", "war"], ["じゃなかったです", "war nicht"]], [
    ["私{わたし} は / 学生{がくせい} です 。", "Watashi wa gakusei desu.", "Ich bin Student."],
    ["田中{たなか} さん は / 先生{せんせい} です 。", "Tanaka-san wa sensei desu.", "Herr Tanaka ist Lehrer."],
    ["私{わたし} は / 日本人{にほんじん} じゃないです 。", "Watashi wa nihonjin ja nai desu.", "Ich bin kein Japaner."],
    ["きのう は / 休{やす}み でした 。", "Kinō wa yasumi deshita.", "Gestern war ein freier Tag."],
  ], [
    { t: "mc", s: "わたしは がくせい ＿。", opts: ["です", "でした", "じゃないです", "ですか"], a: "です", ro: "Watashi wa gakusei desu.", de: "Ich bin Student." },
    { t: "mc", s: "わたしは にほんじん ＿。", opts: ["じゃないです", "です", "でした", "ですか"], a: "じゃないです", ro: "Watashi wa nihonjin ja nai desu.", de: "Ich bin kein Japaner." },
    { t: "mc", s: "きのうは やすみ ＿。", opts: ["でした", "です", "じゃないです", "ですか"], a: "でした", ro: "Kinō wa yasumi deshita.", de: "Gestern war ein freier Tag." },
    { t: "build", src: "わたし は / オーストリアじん です 。", ro: "Watashi wa Ōsutoria-jin desu.", de: "Ich bin Österreicher." },
    { t: "pick", s: "せんせいは にほんじん じゃないです。", ro: "Sensei wa nihonjin ja nai desu.", a: "Der Lehrer ist kein Japaner.", opts: ["Der Lehrer ist kein Japaner.", "Der Lehrer ist Japaner.", "Ich bin kein Lehrer.", "Der Lehrer war Japaner."] },
  ]),
  G("ka", "❓", "か – Fragen", "～ですか", "N5", [
    "Ein か am Satzende macht aus einer Aussage eine Frage – wie ein gesprochenes Fragezeichen. Die Wortstellung bleibt gleich!",
    "Fragewörter (なに/なん, だれ, どこ, いつ, いくら) stehen genau dort, wo später die Antwort steht.",
    "Antworten: はい、そうです。(Ja, genau.) – いいえ、ちがいます。(Nein, stimmt nicht.)",
  ], [["～ですか", "ist …?"], ["なんですか", "was ist …?"], ["だれですか", "wer ist …?"], ["どこですか", "wo ist …?"], ["はい、そうです", "ja, genau"], ["いいえ、ちがいます", "nein, stimmt nicht"]], [
    ["学生{がくせい} です か 。", "Gakusei desu ka.", "Bist du Student?"],
    ["これ は / 何{なん} です か 。", "Kore wa nan desu ka.", "Was ist das?"],
    ["トイレ は / どこ です か 。", "Toire wa doko desu ka.", "Wo ist die Toilette?"],
    ["はい 、 そう です 。", "Hai, sō desu.", "Ja, genau."],
    ["いいえ 、 ちがいます 。", "Iie, chigaimasu.", "Nein, das stimmt nicht."],
  ], [
    { t: "mc", s: "トイレは どこです ＿。", opts: ["か", "を", "の", "も"], a: "か", ro: "Toire wa doko desu ka.", de: "Wo ist die Toilette?" },
    { t: "mc", s: "これは ＿ですか。", opts: ["なん", "だれ", "どこ", "いつ"], a: "なん", ro: "Kore wa nan desu ka.", de: "Was ist das?" },
    { t: "mc", s: "あの ひとは ＿ですか。", opts: ["だれ", "なん", "どこ", "いくら"], a: "だれ", ro: "Ano hito wa dare desu ka.", de: "Wer ist die Person dort?" },
    { t: "build", src: "えき は / どこ です か 。", ro: "Eki wa doko desu ka.", de: "Wo ist der Bahnhof?" },
    { t: "pick", s: "たなかさんは せんせいですか。", ro: "Tanaka-san wa sensei desu ka.", a: "Ist Herr Tanaka Lehrer?", opts: ["Ist Herr Tanaka Lehrer?", "Herr Tanaka ist Lehrer.", "Wo ist Herr Tanaka?", "Wer ist Lehrer?"] },
  ]),
  G("no", "🔗", "の – von / mein", "A の B", "N5", [
    "の verbindet zwei Nomen: A の B = „B von A“. わたしの ほん = mein Buch, ともだちの くるま = das Auto meines Freundes.",
    "Auch für Herkunft oder Art: にほんの くるま (ein Auto aus Japan), にほんごの せんせい (Japanischlehrer/in).",
    "Ist klar, worum es geht, fällt das zweite Nomen weg: それは わたしのです。(Das ist meins.)",
  ], [["わたしの", "mein"], ["あなたの", "dein / Ihr"], ["だれの", "wessen?"], ["にほんの", "aus Japan / japanisch"]], [
    ["私{わたし} の 本{ほん} です 。", "Watashi no hon desu.", "Das ist mein Buch."],
    ["これ は / 父{ちち} の 車{くるま} です 。", "Kore wa chichi no kuruma desu.", "Das ist das Auto meines Vaters."],
    ["日本語{にほんご} の 先生{せんせい} は / やさしい です 。", "Nihongo no sensei wa yasashii desu.", "Die Japanischlehrerin ist nett."],
    ["それ は / だれ の かさ です か 。", "Sore wa dare no kasa desu ka.", "Wessen Schirm ist das?"],
    ["その かばん は / 私{わたし} の です 。", "Sono kaban wa watashi no desu.", "Die Tasche gehört mir."],
  ], [
    { t: "mc", s: "これは わたし＿ ほんです。", opts: ["の", "は", "を", "か"], a: "の", ro: "Kore wa watashi no hon desu.", de: "Das ist mein Buch." },
    { t: "mc", s: "それは ＿の かさですか。", opts: ["だれ", "なに", "どこ", "いつ"], a: "だれ", ro: "Sore wa dare no kasa desu ka.", de: "Wessen Schirm ist das?" },
    { t: "build", src: "これ は / ともだち の くるま です 。", ro: "Kore wa tomodachi no kuruma desu.", de: "Das ist das Auto meines Freundes." },
    { t: "build", src: "わたし は / にほんご の がくせい です 。", ro: "Watashi wa nihongo no gakusei desu.", de: "Ich bin Japanisch-Student." },
    { t: "pick", s: "これは せんせいの ほんです。", ro: "Kore wa sensei no hon desu.", a: "Das ist das Buch des Lehrers.", opts: ["Das ist das Buch des Lehrers.", "Das ist mein Buch.", "Der Lehrer liest ein Buch.", "Ist das das Buch des Lehrers?"] },
  ]),
  G("kosoado", "👉", "これ・この・ここ", "これ / この ～ / ここ", "N5", [
    "これ / それ / あれ stehen allein: これ = das hier (bei mir), それ = das da (bei dir), あれ = das dort drüben (weit weg von beiden). Frage: どれ? (welches?)",
    "この / その / あの / どの stehen immer VOR einem Nomen: この ほん = dieses Buch. Allein gehen sie nicht!",
    "Für Orte: ここ (hier), そこ (da), あそこ (dort drüben), どこ (wo?).",
  ], [["これ / この ～", "das hier / dieses …"], ["それ / その ～", "das da / das … (bei dir)"], ["あれ / あの ～", "das dort / das … dort drüben"], ["どれ / どの ～", "welches? / welches …?"], ["ここ・そこ・あそこ・どこ", "hier · da · dort drüben · wo?"]], [
    ["これ は / いくら です か 。", "Kore wa ikura desu ka.", "Wie viel kostet das?"],
    ["この 本{ほん} は / おもしろい です 。", "Kono hon wa omoshiroi desu.", "Dieses Buch ist interessant."],
    ["あの 人{ひと} は / だれ です か 。", "Ano hito wa dare desu ka.", "Wer ist die Person dort drüben?"],
    ["トイレ は / あそこ です 。", "Toire wa asoko desu.", "Die Toilette ist dort drüben."],
    ["どの かさ です か 。", "Dono kasa desu ka.", "Welcher Schirm ist es?"],
  ], [
    { t: "mc", s: "＿ ほんは おもしろいです。", opts: ["この", "これ", "ここ", "どの"], a: "この", ro: "Kono hon wa omoshiroi desu.", de: "Dieses Buch ist interessant." },
    { t: "mc", s: "＿は いくらですか。", opts: ["これ", "この", "ここ", "どの"], a: "これ", ro: "Kore wa ikura desu ka.", de: "Wie viel kostet das (hier)?" },
    { t: "mc", s: "えきは ＿です。", opts: ["あそこ", "あの", "あれ", "どこ"], a: "あそこ", ro: "Eki wa asoko desu.", de: "Der Bahnhof ist dort drüben." },
    { t: "build", src: "あの ひと は / だれ です か 。", ro: "Ano hito wa dare desu ka.", de: "Wer ist die Person dort drüben?" },
    { t: "pickja", de: "Welcher ist dein Schirm?", a: "あなたの かさは どれですか。", ro: "Anata no kasa wa dore desu ka.", opts: ["あなたの かさは どれですか。", "これは あなたの かさです。", "あなたの かさは どこですか。", "あれは かさですか。"] },
  ]),
  G("mo", "➕", "も – auch", "A も", "N5", [
    "も heißt „auch“ und ersetzt は, が oder を: わたしも = ich auch, これも = das auch.",
    "も steht direkt hinter dem Wort, das „auch“ gilt. Zweimal: Aも Bも = sowohl A als auch B.",
    "Mit Fragewort und Verneinung: なにも ～ません = nichts, だれも ～ません = niemand.",
  ], [["わたしも", "ich auch"], ["これも", "das auch"], ["Aも Bも", "sowohl A als auch B"], ["なにも ～ません", "nichts"], ["だれも ～ません", "niemand"]], [
    ["私{わたし} も / 学生{がくせい} です 。", "Watashi mo gakusei desu.", "Ich bin auch Student."],
    ["田中{たなか} さん も / 来{き}ます 。", "Tanaka-san mo kimasu.", "Herr Tanaka kommt auch."],
    ["ねこ も / いぬ も / 好{す}き です 。", "Neko mo inu mo suki desu.", "Ich mag Katzen und auch Hunde."],
    ["今日{きょう} は / 何{なに} も / 食{た}べません でした 。", "Kyō wa nani mo tabemasen deshita.", "Heute habe ich nichts gegessen."],
  ], [
    { t: "mc", s: "わたし＿ コーヒーが すきです。", opts: ["も", "の", "を", "か"], a: "も", ro: "Watashi mo kōhī ga suki desu.", de: "Ich mag auch Kaffee (so wie du)." },
    { t: "mc", s: "これ＿ ください。", opts: ["も", "の", "か", "に"], a: "も", ro: "Kore mo kudasai.", de: "Das bitte auch." },
    { t: "mc", s: "きょうは なに＿ たべませんでした。", opts: ["も", "を", "が", "の"], a: "も", ro: "Kyō wa nani mo tabemasen deshita.", de: "Heute habe ich nichts gegessen." },
    { t: "build", src: "ともだち も / にほんご を / べんきょう します 。", ro: "Tomodachi mo nihongo o benkyō shimasu.", de: "Mein Freund lernt auch Japanisch." },
    { t: "pick", s: "いぬも ねこも すきです。", ro: "Inu mo neko mo suki desu.", a: "Ich mag Hunde und auch Katzen.", opts: ["Ich mag Hunde und auch Katzen.", "Ich mag weder Hunde noch Katzen.", "Ich mag Hunde, aber keine Katzen.", "Ist das ein Hund oder eine Katze?"] },
  ]),
  G("aru", "📦", "あります / います", "Ort に ～が あります", "N5", [
    "あります = es gibt / ist da – für Dinge und Pflanzen. います = für Lebewesen (Menschen, Tiere).",
    "Muster: Ort に Ding が あります。→ つくえの うえに ほんが あります。(Auf dem Tisch liegt ein Buch.)",
    "Verneinung: ありません / いません. Auch für „haben“: おかねが ありません。(Ich habe kein Geld.) きょうだいが います。(Ich habe Geschwister.)",
  ], [["あります", "es gibt (Dinge)"], ["ありません", "es gibt nicht"], ["います", "es gibt / ist da (Lebewesen)"], ["いません", "ist nicht da"], ["Ort に ～が あります", "an einem Ort gibt es …"]], [
    ["つくえ の 上{うえ} に / 本{ほん} が / あります 。", "Tsukue no ue ni hon ga arimasu.", "Auf dem Tisch liegt ein Buch."],
    ["公園{こうえん} に / 犬{いぬ} が / います 。", "Kōen ni inu ga imasu.", "Im Park ist ein Hund."],
    ["お金{かね} が / ありません 。", "Okane ga arimasen.", "Ich habe kein Geld."],
    ["兄弟{きょうだい} が / います か 。", "Kyōdai ga imasu ka.", "Hast du Geschwister?"],
    ["駅{えき} の 近{ちか}く に / コンビニ が / あります 。", "Eki no chikaku ni konbini ga arimasu.", "In der Nähe vom Bahnhof gibt es einen Konbini."],
  ], [
    { t: "mc", s: "こうえんに いぬが ＿。", opts: ["います", "あります", "です", "します"], a: "います", ro: "Kōen ni inu ga imasu.", de: "Im Park ist ein Hund." },
    { t: "mc", s: "へやに テレビが ＿。", opts: ["あります", "います", "です", "いきます"], a: "あります", ro: "Heya ni terebi ga arimasu.", de: "Im Zimmer steht ein Fernseher." },
    { t: "mc", s: "おかねが ＿。", opts: ["ありません", "いません", "じゃないです", "あります"], a: "ありません", ro: "Okane ga arimasen.", de: "Ich habe kein Geld." },
    { t: "build", src: "いえ に / ねこ が / います 。", ro: "Ie ni neko ga imasu.", de: "Zu Hause ist eine Katze." },
    { t: "pick", s: "きょうだいが いますか。", ro: "Kyōdai ga imasu ka.", a: "Hast du Geschwister?", opts: ["Hast du Geschwister?", "Wo sind deine Geschwister?", "Ich habe keine Geschwister.", "Sind das deine Eltern?"] },
  ]),
  G("masu", "🔁", "ます-Form: Zeiten", "～ます・～ません・～ました", "N5", [
    "Höfliche Verben enden auf ～ます. Es gibt nur zwei Zeiten: Gegenwart/Zukunft (～ます) und Vergangenheit (～ました).",
    "Verneinung: ～ません (tue nicht). Vergangenheit verneint: ～ませんでした (habe nicht getan).",
    "Beispiel たべます: たべます (esse / werde essen) · たべません · たべました · たべませんでした.",
  ], [["～ます", "tue / werde tun"], ["～ません", "tue nicht"], ["～ました", "habe getan"], ["～ませんでした", "habe nicht getan"]], [
    ["毎日{まいにち} / コーヒー を / 飲{の}みます 。", "Mainichi kōhī o nomimasu.", "Ich trinke jeden Tag Kaffee."],
    ["あした / 東京{とうきょう} に / 行{い}きます 。", "Ashita Tōkyō ni ikimasu.", "Morgen fahre ich nach Tokio."],
    ["肉{にく} を / 食{た}べません 。", "Niku o tabemasen.", "Ich esse kein Fleisch."],
    ["きのう / テレビ を / 見{み}ました 。", "Kinō terebi o mimashita.", "Gestern habe ich ferngesehen."],
    ["けさ は / 何{なに} も / 食{た}べません でした 。", "Kesa wa nani mo tabemasen deshita.", "Heute in der Früh habe ich nichts gegessen."],
  ], [
    { t: "mc", s: "きのう えいがを ＿。", opts: ["みました", "みます", "みません", "みませんでした"], a: "みました", ro: "Kinō eiga o mimashita.", de: "Gestern habe ich einen Film gesehen." },
    { t: "mc", s: "わたしは おさけを ＿。", opts: ["のみません", "のみます", "のみました", "のみませんでした"], a: "のみません", ro: "Watashi wa osake o nomimasen.", de: "Ich trinke keinen Alkohol." },
    { t: "mc", s: "きのうは べんきょう ＿。", opts: ["しませんでした", "しません", "しました", "します"], a: "しませんでした", ro: "Kinō wa benkyō shimasen deshita.", de: "Gestern habe ich nicht gelernt." },
    { t: "mc", s: "あした しごとに ＿。", opts: ["いきます", "いきました", "いきませんでした", "いきません"], a: "いきます", ro: "Ashita shigoto ni ikimasu.", de: "Morgen gehe ich in die Arbeit." },
    { t: "build", src: "まいにち / にほんご を / べんきょう します 。", ro: "Mainichi nihongo o benkyō shimasu.", de: "Ich lerne jeden Tag Japanisch." },
  ]),
  G("wo", "🎯", "を – Objekt", "～を Verb", "N5", [
    "を (gesprochen „o“) markiert das direkte Objekt – das, womit etwas gemacht wird: パンを たべます (Brot essen).",
    "Reihenfolge: (Wer は) – Was を – Verb. Das Verb steht ganz am Ende.",
    "Nach dem Objekt fragen: なにを …か。(Was …?)",
  ], [["～を たべます", "… essen"], ["～を のみます", "… trinken"], ["～を みます", "… anschauen"], ["なにを ～か", "was …?"]], [
    ["パン を / 食{た}べます 。", "Pan o tabemasu.", "Ich esse Brot."],
    ["毎朝{まいあさ} / お茶{ちゃ} を / 飲{の}みます 。", "Maiasa ocha o nomimasu.", "Jeden Morgen trinke ich Tee."],
    ["何{なに} を / します か 。", "Nani o shimasu ka.", "Was machst du?"],
    ["手紙{てがみ} を / 書{か}きます 。", "Tegami o kakimasu.", "Ich schreibe einen Brief."],
    ["日本語{にほんご} を / 勉強{べんきょう} します 。", "Nihongo o benkyō shimasu.", "Ich lerne Japanisch."],
  ], [
    { t: "mc", s: "パン＿ たべます。", opts: ["を", "に", "で", "の"], a: "を", ro: "Pan o tabemasu.", de: "Ich esse Brot." },
    { t: "mc", s: "まいばん ほん＿ よみます。", opts: ["を", "に", "へ", "が"], a: "を", ro: "Maiban hon o yomimasu.", de: "Jeden Abend lese ich ein Buch." },
    { t: "mc", s: "なに＿ のみますか。", opts: ["を", "に", "へ", "の"], a: "を", ro: "Nani o nomimasu ka.", de: "Was trinkst du?" },
    { t: "build", src: "わたし は / コーヒー を / のみます 。", ro: "Watashi wa kōhī o nomimasu.", de: "Ich trinke Kaffee." },
    { t: "build", src: "ともだち は / てがみ を / かきます 。", ro: "Tomodachi wa tegami o kakimasu.", de: "Mein Freund schreibt einen Brief." },
  ]),
  G("ni", "📍", "に / へ – Ziel & Zeit", "Ort に いきます・7じ に", "N5", [
    "に hat drei wichtige Aufgaben: ① Ziel einer Bewegung (がっこうに いきます), ② Zeitpunkt mit Uhrzeit, Wochentag, Datum (しちじに おきます), ③ Ort, wo jemand/etwas IST (いえに います).",
    "へ (gesprochen „e“) zeigt nur die Richtung: にほんへ いきます. Bei Bewegungsverben sind に und へ fast gleich.",
    "Keine に bei relativen Zeiten: きょう, あした, まいにち, らいしゅう … stehen ohne Partikel!",
  ], [["Ort に/へ いきます", "nach / zu … gehen"], ["Uhrzeit に", "um … Uhr"], ["Wochentag に", "am …"], ["Ort に います", "ist in / bei …"], ["あした・まいにち (ohne に)", "morgen · jeden Tag"]], [
    ["学校{がっこう} に / 行{い}きます 。", "Gakkō ni ikimasu.", "Ich gehe in die Schule."],
    ["七時{しちじ} に / 起{お}きます 。", "Shichiji ni okimasu.", "Ich stehe um sieben Uhr auf."],
    ["日曜日{にちようび} に / 友達{ともだち} に / 会{あ}います 。", "Nichiyōbi ni tomodachi ni aimasu.", "Am Sonntag treffe ich einen Freund."],
    ["夏休{なつやす}み に / 日本{にほん} へ / 行{い}きます 。", "Natsuyasumi ni Nihon e ikimasu.", "In den Sommerferien fahre ich nach Japan."],
    ["母{はは} は / 家{いえ} に / います 。", "Haha wa ie ni imasu.", "Meine Mutter ist zu Hause."],
  ], [
    { t: "mc", s: "まいあさ ろくじ＿ おきます。", opts: ["に", "で", "を", "へ"], a: "に", ro: "Maiasa rokuji ni okimasu.", de: "Jeden Morgen stehe ich um sechs auf." },
    { t: "mc", s: "らいしゅう にほん＿ いきます。", opts: ["へ", "を", "で", "の"], a: "へ", ro: "Raishū Nihon e ikimasu.", de: "Nächste Woche fahre ich nach Japan." },
    { t: "mc", s: "ちちは いえ＿ います。", opts: ["に", "を", "で", "へ"], a: "に", ro: "Chichi wa ie ni imasu.", de: "Mein Vater ist zu Hause." },
    { t: "build", src: "わたし は / くじ に / かいしゃ に / いきます 。", ro: "Watashi wa kuji ni kaisha ni ikimasu.", de: "Ich gehe um neun Uhr in die Firma." },
    { t: "build", src: "どようび に / こうえん へ / いきます 。", ro: "Doyōbi ni kōen e ikimasu.", de: "Am Samstag gehe ich in den Park." },
  ]),
  G("de", "🛠️", "で – Ort der Handlung & Mittel", "Ort で ～します・バスで", "N5", [
    "で markiert den Ort, an dem etwas GEMACHT wird: レストランで たべます (im Restaurant essen). Achtung: für „sein / sich befinden“ nimmt man に!",
    "で zeigt auch das Mittel: でんしゃで いきます (mit dem Zug fahren), はしで たべます (mit Stäbchen essen), にほんごで はなします (auf Japanisch sprechen).",
    "Fragen: どこで …か。(Wo …?) – なんで …か。(Womit …?)",
  ], [["Ort で ～します", "an einem Ort etwas tun"], ["Verkehrsmittel で", "mit dem …"], ["Werkzeug で", "mit (Werkzeug)"], ["Sprache で", "auf (Sprache)"]], [
    ["レストラン で / 晩{ばん}ごはん を / 食{た}べます 。", "Resutoran de bangohan o tabemasu.", "Ich esse im Restaurant zu Abend."],
    ["電車{でんしゃ} で / 会社{かいしゃ} に / 行{い}きます 。", "Densha de kaisha ni ikimasu.", "Ich fahre mit dem Zug in die Firma."],
    ["はし で / 食{た}べます 。", "Hashi de tabemasu.", "Ich esse mit Stäbchen."],
    ["日本語{にほんご} で / 話{はな}します 。", "Nihongo de hanashimasu.", "Ich spreche auf Japanisch."],
    ["図書館{としょかん} で / 本{ほん} を / 読{よ}みます 。", "Toshokan de hon o yomimasu.", "Ich lese in der Bibliothek ein Buch."],
  ], [
    { t: "mc", s: "レストラン＿ ごはんを たべます。", opts: ["で", "に", "を", "へ"], a: "で", ro: "Resutoran de gohan o tabemasu.", de: "Ich esse im Restaurant." },
    { t: "mc", s: "バス＿ がっこうに いきます。", opts: ["で", "に", "を", "の"], a: "で", ro: "Basu de gakkō ni ikimasu.", de: "Ich fahre mit dem Bus zur Schule." },
    { t: "mc", s: "にほんご＿ はなします。", opts: ["で", "に", "へ", "の"], a: "で", ro: "Nihongo de hanashimasu.", de: "Ich spreche auf Japanisch." },
    { t: "mc", s: "いえ＿ テレビを みます。", opts: ["で", "に", "を", "へ"], a: "で", ro: "Ie de terebi o mimasu.", de: "Ich schaue zu Hause fern." },
    { t: "build", src: "としょかん で / ほん を / よみます 。", ro: "Toshokan de hon o yomimasu.", de: "Ich lese in der Bibliothek ein Buch." },
  ]),
  G("to", "🤝", "と – und / mit", "A と B・Person と", "N5", [
    "と verbindet Nomen: A と B = „A und B“ (vollständige Aufzählung): パンと たまご (Brot und Ei).",
    "Mit Personen heißt と „mit“: ともだちと いきます (mit einem Freund hingehen). Allein = ひとりで.",
    "Achtung: と verbindet nur Nomen – keine Sätze!",
  ], [["A と B", "A und B"], ["Person と", "mit (Person)"], ["だれと", "mit wem?"], ["ひとりで", "allein"]], [
    ["パン と 卵{たまご} を / 食{た}べます 。", "Pan to tamago o tabemasu.", "Ich esse Brot und Eier."],
    ["友達{ともだち} と / 映画{えいが} を / 見{み}ます 。", "Tomodachi to eiga o mimasu.", "Ich schaue mit einem Freund einen Film."],
    ["だれ と / 行{い}きます か 。", "Dare to ikimasu ka.", "Mit wem gehst du hin?"],
    ["家族{かぞく} と / 旅行{りょこう} します 。", "Kazoku to ryokō shimasu.", "Ich verreise mit meiner Familie."],
    ["ひとり で / 行{い}きます 。", "Hitori de ikimasu.", "Ich gehe allein."],
  ], [
    { t: "mc", s: "ともだち＿ えいがを みます。", opts: ["と", "を", "に", "で"], a: "と", ro: "Tomodachi to eiga o mimasu.", de: "Ich schaue mit einem Freund einen Film." },
    { t: "mc", s: "コーヒー＿ ケーキを ください。", opts: ["と", "に", "で", "へ"], a: "と", ro: "Kōhī to kēki o kudasai.", de: "Einen Kaffee und einen Kuchen, bitte." },
    { t: "mc", s: "＿と いきますか。", opts: ["だれ", "なに", "どこ", "いつ"], a: "だれ", ro: "Dare to ikimasu ka.", de: "Mit wem gehst du hin?" },
    { t: "build", src: "かぞく と / にほん に / いきます 。", ro: "Kazoku to Nihon ni ikimasu.", de: "Ich fahre mit meiner Familie nach Japan." },
    { t: "pick", s: "ははと かいものを します。", ro: "Haha to kaimono o shimasu.", a: "Ich gehe mit meiner Mutter einkaufen.", opts: ["Ich gehe mit meiner Mutter einkaufen.", "Meine Mutter geht allein einkaufen.", "Ich kaufe meiner Mutter etwas.", "Meine Mutter und ich kochen."] },
  ]),
  G("kara", "↔️", "から / まで – von / bis", "A から B まで", "N5", [
    "から = von / ab (Startpunkt), まで = bis (Endpunkt) – für Zeit und Ort.",
    "くじから ごじまで はたらきます。(Ich arbeite von neun bis fünf.) – ウィーンから ザルツブルクまで (von Wien bis Salzburg).",
    "Woher? = どこから …か。 Bis wann? = いつまで …か。",
  ], [["～から", "von / ab"], ["～まで", "bis"], ["A から B まで", "von A bis B"], ["どこから", "woher?"], ["いつまで", "bis wann?"]], [
    ["九時{くじ} から / 五時{ごじ} まで / 働{はたら}きます 。", "Kuji kara goji made hatarakimasu.", "Ich arbeite von neun bis fünf."],
    ["オーストリア から / 来{き}ました 。", "Ōsutoria kara kimashita.", "Ich komme aus Österreich."],
    ["駅{えき} まで / 歩{ある}きます 。", "Eki made arukimasu.", "Ich gehe zu Fuß bis zum Bahnhof."],
    ["授業{じゅぎょう} は / 何時{なんじ} から です か 。", "Jugyō wa nanji kara desu ka.", "Ab wie viel Uhr ist der Unterricht?"],
    ["ウィーン から / 東京{とうきょう} まで / 飛行機{ひこうき} で / 行{い}きます 。", "Wīn kara Tōkyō made hikōki de ikimasu.", "Ich fliege von Wien nach Tokio."],
  ], [
    { t: "mc", s: "くじ＿ ごじまで はたらきます。", opts: ["から", "まで", "に", "で"], a: "から", ro: "Kuji kara goji made hatarakimasu.", de: "Ich arbeite von neun bis fünf." },
    { t: "mc", s: "えき＿ あるきます。", opts: ["まで", "から", "を", "の"], a: "まで", ro: "Eki made arukimasu.", de: "Ich gehe zu Fuß bis zum Bahnhof." },
    { t: "mc", s: "どこ＿ きましたか。", opts: ["から", "まで", "で", "を"], a: "から", ro: "Doko kara kimashita ka.", de: "Woher kommst du?" },
    { t: "build", src: "オーストリア から / きました 。", ro: "Ōsutoria kara kimashita.", de: "Ich komme aus Österreich." },
    { t: "build", src: "しごと は / ごご ごじ まで です 。", ro: "Shigoto wa gogo goji made desu.", de: "Die Arbeit geht bis fünf Uhr nachmittags." },
  ]),
  G("iadj", "🌶️", "い-Adjektive beugen", "たかい・たかくない・たかかった", "N5", [
    "い-Adjektive enden auf い: たかい, おいしい, さむい. Vor です bleiben sie gleich: たかいです.",
    "Verneinung: い → くない (たかくないです). Vergangenheit: い → かった (たかかったです). Beides: くなかった (たかくなかったです).",
    "Vor einem Nomen einfach davor: たかい くるま (ein teures Auto). Ausnahme いい (gut): よくない, よかった! Falsch wäre „たかいでした“.",
  ], [["たかいです", "ist teuer"], ["たかくないです", "ist nicht teuer"], ["たかかったです", "war teuer"], ["たかくなかったです", "war nicht teuer"], ["いい → よくない・よかった", "gut (Ausnahme)"]], [
    ["この ラーメン は / おいしい です 。", "Kono rāmen wa oishii desu.", "Diese Ramen sind lecker."],
    ["今日{きょう} は / 寒{さむ}くない です 。", "Kyō wa samukunai desu.", "Heute ist es nicht kalt."],
    ["きのう の テスト は / むずかしかった です 。", "Kinō no tesuto wa muzukashikatta desu.", "Der Test gestern war schwierig."],
    ["大{おお}きい 家{いえ} です ね 。", "Ōkii ie desu ne.", "Das ist aber ein großes Haus!"],
    ["天気{てんき} が / よかった です 。", "Tenki ga yokatta desu.", "Das Wetter war schön."],
  ], [
    { t: "mc", s: "きょうは ＿です。", opts: ["さむくない", "さむい", "さむかった", "さむくなかった"], a: "さむくない", ro: "Kyō wa samukunai desu.", de: "Heute ist es nicht kalt." },
    { t: "mc", s: "きのうの テストは ＿です。", opts: ["むずかしかった", "むずかしい", "むずかしくない", "むずかしいでした"], a: "むずかしかった", ro: "Kinō no tesuto wa muzukashikatta desu.", de: "Der Test gestern war schwierig." },
    { t: "mc", s: "てんきが ＿です。", opts: ["よかった", "いかった", "いいでした", "よくない"], a: "よかった", ro: "Tenki ga yokatta desu.", de: "Das Wetter war schön." },
    { t: "mc", s: "これは ＿ くるまです。", opts: ["たかい", "たかく", "たかいな", "たかくて"], a: "たかい", ro: "Kore wa takai kuruma desu.", de: "Das ist ein teures Auto." },
    { t: "build", src: "この ラーメン は / おいしい です 。", ro: "Kono rāmen wa oishii desu.", de: "Diese Ramen sind lecker." },
  ]),
  G("naadj", "🌸", "な-Adjektive beugen", "しずか・しずかな へや", "N5", [
    "な-Adjektive (z. B. しずか, きれい, げんき, すき, ひま) verhalten sich wie Nomen: しずかです (ist ruhig).",
    "Verneinung: しずかじゃないです. Vergangenheit: しずかでした. Beides: しずかじゃなかったです.",
    "Vor einem Nomen kommt な dazwischen: しずかな へや (ein ruhiges Zimmer). Achtung: きれい sieht aus wie ein い-Adjektiv, ist aber ein な-Adjektiv!",
  ], [["しずかです", "ist ruhig"], ["しずかじゃないです", "ist nicht ruhig"], ["しずかでした", "war ruhig"], ["しずかじゃなかったです", "war nicht ruhig"], ["しずかな へや", "ein ruhiges Zimmer"]], [
    ["この 町{まち} は / 静{しず}か です 。", "Kono machi wa shizuka desu.", "Diese Stadt ist ruhig."],
    ["きれい な 花{はな} です ね 。", "Kirei na hana desu ne.", "Was für eine schöne Blume!"],
    ["私{わたし} は / 魚{さかな} が / 好{す}きじゃないです 。", "Watashi wa sakana ga suki ja nai desu.", "Ich mag keinen Fisch."],
    ["きのう は / ひま でした 。", "Kinō wa hima deshita.", "Gestern hatte ich Zeit."],
    ["田中{たなか} さん は / 親切{しんせつ} な 人{ひと} です 。", "Tanaka-san wa shinsetsu na hito desu.", "Herr Tanaka ist ein hilfsbereiter Mensch."],
  ], [
    { t: "mc", s: "しずか＿ へやです。", opts: ["な", "の", "い", "に"], a: "な", ro: "Shizuka na heya desu.", de: "Das ist ein ruhiges Zimmer." },
    { t: "mc", s: "きのうは ＿。", opts: ["ひまでした", "ひまかった", "ひまいでした", "ひまくなかった"], a: "ひまでした", ro: "Kinō wa hima deshita.", de: "Gestern hatte ich Zeit." },
    { t: "mc", s: "この まちは ＿です。", opts: ["にぎやかじゃない", "にぎやかくない", "にぎやかな", "にぎやかかった"], a: "にぎやかじゃない", ro: "Kono machi wa nigiyaka ja nai desu.", de: "Diese Stadt ist nicht belebt." },
    { t: "mc", s: "わたしは ねこが ＿です。", opts: ["すき", "すきな", "すきい", "すきく"], a: "すき", ro: "Watashi wa neko ga suki desu.", de: "Ich mag Katzen." },
    { t: "build", src: "たなかさん は / しんせつ な ひと です 。", ro: "Tanaka-san wa shinsetsu na hito desu.", de: "Herr Tanaka ist ein hilfsbereiter Mensch." },
  ]),
  G("waga", "⚖️", "は oder が?", "Thema は・Subjekt が", "N5", [
    "は (gesprochen „wa“) zeigt das Thema: „Was … betrifft“. Danach kommt die Aussage darüber: わたしは がくせいです.",
    "が zeigt das Subjekt – oft bei neuer Information und immer bei Fragewörtern als Subjekt: だれが きましたか。— たなかさんが きました。",
    "Feste Muster mit が: ～が すきです, ～が わかります, ～が あります/います, ～が じょうずです, あたまが いたいです.",
  ], [["Thema は ～", "was … betrifft"], ["Fragewort が ～か", "wer/was …? (Subjekt)"], ["～が すきです", "… mögen"], ["～が わかります", "… verstehen"], ["～が いたいです", "… tut weh"]], [
    ["私{わたし} は / オーストリア人{じん} です 。", "Watashi wa Ōsutoria-jin desu.", "Ich bin Österreicher."],
    ["だれ が / 来{き}ました か 。", "Dare ga kimashita ka.", "Wer ist gekommen?"],
    ["田中{たなか} さん が / 来{き}ました 。", "Tanaka-san ga kimashita.", "Herr Tanaka ist gekommen."],
    ["私{わたし} は / 音楽{おんがく} が / 好{す}き です 。", "Watashi wa ongaku ga suki desu.", "Ich mag Musik."],
    ["日本語{にほんご} が / 少{すこ}し / わかります 。", "Nihongo ga sukoshi wakarimasu.", "Ich verstehe ein bisschen Japanisch."],
  ], [
    { t: "mc", s: "だれ＿ きましたか。", opts: ["が", "は", "を", "で"], a: "が", ro: "Dare ga kimashita ka.", de: "Wer ist gekommen?" },
    { t: "mc", s: "わたしは すし＿ すきです。", opts: ["が", "を", "に", "で"], a: "が", ro: "Watashi wa sushi ga suki desu.", de: "Ich mag Sushi." },
    { t: "mc", s: "わたし＿ フロリアンです。", opts: ["は", "を", "に", "で"], a: "は", ro: "Watashi wa Furorian desu.", de: "Ich bin Florian." },
    { t: "mc", s: "にほんご＿ わかりますか。", opts: ["が", "を", "で", "に"], a: "が", ro: "Nihongo ga wakarimasu ka.", de: "Verstehst du Japanisch?" },
    { t: "build", src: "わたし は / おんがく が / すき です 。", ro: "Watashi wa ongaku ga suki desu.", de: "Ich mag Musik." },
  ]),
  G("mashou", "🙌", "～ませんか / ～ましょう", "Einladen & Vorschlagen", "N5", [
    "～ませんか = „Wollen wir nicht …?“ – eine höfliche Einladung: いっしょに えいがを みませんか。",
    "～ましょう = „Lass uns …!“ – ein Vorschlag oder die Zusage: いいですね。みましょう！",
    "～ましょうか = „Sollen wir …? / Soll ich …?“ – auch um Hilfe anzubieten: てつだいましょうか。",
  ], [["～ませんか", "wollen wir nicht …?"], ["～ましょう", "lass(t) uns …!"], ["～ましょうか", "sollen wir / soll ich …?"], ["いいですね", "gute Idee!"]], [
    ["いっしょに / 映画{えいが} を / 見{み}ません か 。", "Issho ni eiga o mimasen ka.", "Wollen wir nicht zusammen einen Film schauen?"],
    ["いい です ね 。 見{み}ましょう ！", "Ii desu ne. Mimashō!", "Gute Idee. Schauen wir ihn an!"],
    ["ちょっと / 休{やす}みましょう 。", "Chotto yasumimashō.", "Machen wir kurz Pause."],
    ["手伝{てつだ}いましょう か 。", "Tetsudaimashō ka.", "Soll ich helfen?"],
    ["土曜日{どようび} に / テニス を / しません か 。", "Doyōbi ni tenisu o shimasen ka.", "Wollen wir am Samstag Tennis spielen?"],
  ], [
    { t: "mc", s: "いっしょに コーヒーを ＿か。", opts: ["のみません", "のみませんでした", "のみました", "のみたい"], a: "のみません", ro: "Issho ni kōhī o nomimasen ka.", de: "Wollen wir nicht zusammen Kaffee trinken?" },
    { t: "mc", s: "ちょっと ＿。", opts: ["やすみましょう", "やすみません", "やすみました", "やすみますか"], a: "やすみましょう", ro: "Chotto yasumimashō.", de: "Machen wir kurz Pause!" },
    { t: "mc", s: "にもつを ＿か。", opts: ["もちましょう", "もちました", "もって", "もちませんでした"], a: "もちましょう", ro: "Nimotsu o mochimashō ka.", de: "Soll ich das Gepäck tragen?" },
    { t: "build", src: "どようび に / テニス を / しません か 。", ro: "Doyōbi ni tenisu o shimasen ka.", de: "Wollen wir am Samstag Tennis spielen?" },
    { t: "pick", s: "えきで あいましょう。", ro: "Eki de aimashō.", a: "Treffen wir uns am Bahnhof!", opts: ["Treffen wir uns am Bahnhof!", "Ich habe dich am Bahnhof getroffen.", "Wo ist der Bahnhof?", "Ich gehe nicht zum Bahnhof."] },
  ]),
  G("counter", "🔢", "Zählwörter", "ひとつ・ひとり・いっぽん・いちまい", "N5", [
    "Im Japanischen zählt man mit Zählwörtern – je nach Art des Dings. Für allgemeine Dinge: ひとつ, ふたつ, みっつ … とお (1–10).",
    "Personen: ひとり, ふたり, さんにん, よにん. Lange Dinge (Flaschen, Stifte): いっぽん, にほん, さんぼん. Flache Dinge (Papier, Tickets, Hemden): いちまい, にまい, さんまい.",
    "Die Menge steht meist direkt vor dem Verb: りんごを みっつ ください。(Drei Äpfel, bitte.) Fragen: いくつ? なんにん? なんぼん? なんまい?",
  ], [["ひとつ・ふたつ・みっつ", "1 · 2 · 3 (Dinge)"], ["ひとり・ふたり・さんにん", "1 · 2 · 3 Personen"], ["いっぽん・にほん・さんぼん", "1 · 2 · 3 (lange Dinge)"], ["いちまい・にまい・さんまい", "1 · 2 · 3 (flache Dinge)"], ["いくつ・なんにん・なんぼん・なんまい", "wie viele?"]], [
    ["りんご を / 三{みっ}つ / ください 。", "Ringo o mittsu kudasai.", "Drei Äpfel, bitte."],
    ["家族{かぞく} は / 四人{よにん} です 。", "Kazoku wa yonin desu.", "Wir sind zu viert in der Familie."],
    ["ビール を / 二本{にほん} / ください 。", "Bīru o nihon kudasai.", "Zwei Flaschen Bier, bitte."],
    ["切手{きって} を / 五枚{ごまい} / 買{か}いました 。", "Kitte o gomai kaimashita.", "Ich habe fünf Briefmarken gekauft."],
    ["子{こ}ども が / 二人{ふたり} / います 。", "Kodomo ga futari imasu.", "Ich habe zwei Kinder."],
  ], [
    { t: "mc", s: "ペンを ＿ かいました。", opts: ["にほん", "ふたり", "にまい", "にさい"], a: "にほん", ro: "Pen o nihon kaimashita.", de: "Ich habe zwei Kulis gekauft." },
    { t: "mc", s: "かぞくは ＿です。", opts: ["さんにん", "みっつ", "さんぼん", "さんまい"], a: "さんにん", ro: "Kazoku wa sannin desu.", de: "Wir sind zu dritt in der Familie." },
    { t: "mc", s: "きっぷを ＿ ください。", opts: ["いちまい", "いっぽん", "ひとり", "いっこ"], a: "いちまい", ro: "Kippu o ichimai kudasai.", de: "Eine Fahrkarte, bitte." },
    { t: "mc", s: "りんごを ＿ ください。", opts: ["みっつ", "さんにん", "さんまい", "さんぼん"], a: "みっつ", ro: "Ringo o mittsu kudasai.", de: "Drei Äpfel, bitte." },
    { t: "build", src: "こども が / ふたり / います 。", ro: "Kodomo ga futari imasu.", de: "Ich habe zwei Kinder." },
  ]),
  G("tai", "💭", "～たい – möchten", "たべたいです", "N5", [
    "～たい = „ich möchte …“: ます weg, たい dran: たべます → たべたい(です), いきます → いきたい(です).",
    "～たい wird wie ein い-Adjektiv gebeugt: たべたくないです (möchte nicht essen), たべたかったです (wollte essen).",
    "Nur für eigene Wünsche – oder in Fragen: なにが たべたいですか。Das Objekt kann を oder が bekommen.",
  ], [["いきます → いきたいです", "ich möchte gehen"], ["たべたくないです", "ich möchte nicht essen"], ["みたかったです", "ich wollte sehen"], ["なにが したいですか", "was möchtest du machen?"]], [
    ["日本{にほん} に / 行{い}きたい です 。", "Nihon ni ikitai desu.", "Ich möchte nach Japan fahren."],
    ["すし が / 食{た}べたい です 。", "Sushi ga tabetai desu.", "Ich möchte Sushi essen."],
    ["今日{きょう} は / 何{なに} も / したくない です 。", "Kyō wa nani mo shitakunai desu.", "Heute möchte ich gar nichts tun."],
    ["何{なに} が / 飲{の}みたい です か 。", "Nani ga nomitai desu ka.", "Was möchtest du trinken?"],
    ["ずっと / 富士山{ふじさん} を / 見{み}たかった です 。", "Zutto Fujisan o mitakatta desu.", "Ich wollte schon immer den Fuji sehen."],
  ], [
    { t: "mc", s: "にほんに ＿です。", opts: ["いきたい", "いきます", "いきたく", "いきましょう"], a: "いきたい", ro: "Nihon ni ikitai desu.", de: "Ich möchte nach Japan fahren." },
    { t: "mc", s: "きょうは なにも ＿です。", opts: ["したくない", "したい", "しません", "したかった"], a: "したくない", ro: "Kyō wa nani mo shitakunai desu.", de: "Heute möchte ich gar nichts tun." },
    { t: "mc", s: "ずっと ふじさんを ＿です。", opts: ["みたかった", "みたい", "みたくない", "みました"], a: "みたかった", ro: "Zutto Fujisan o mitakatta desu.", de: "Ich wollte schon immer den Fuji sehen." },
    { t: "build", src: "なに が / のみたい です か 。", ro: "Nani ga nomitai desu ka.", de: "Was möchtest du trinken?" },
    { t: "pick", s: "あたらしい くるまが かいたいです。", ro: "Atarashii kuruma ga kaitai desu.", a: "Ich möchte ein neues Auto kaufen.", opts: ["Ich möchte ein neues Auto kaufen.", "Ich habe ein neues Auto gekauft.", "Das neue Auto ist teuer.", "Ich möchte kein neues Auto."] },
  ]),
  G("te", "🙏", "て-Form & ください", "まって ください", "N5", [
    "Die て-Form ist die „Verbindungsform“ – sehr wichtig! Mit ください wird sie zur höflichen Bitte: みて ください (Bitte schau).",
    "Gruppe 2 (ru-Verben): る weg + て: たべる → たべて, みる → みて. Gruppe 3: する → して, くる → きて.",
    "Gruppe 1 (u-Verben) nach der Endung: う・つ・る → って (かう → かって, まつ → まって, とる → とって) · む・ぶ・ぬ → んで (よむ → よんで, あそぶ → あそんで, しぬ → しんで) · く → いて (かく → かいて) · ぐ → いで (およぐ → およいで) · す → して (はなす → はなして). Ausnahme: いく → いって!",
  ], [["う・つ・る → って", "かう → かって"], ["む・ぶ・ぬ → んで", "よむ → よんで"], ["く → いて · ぐ → いで", "かく → かいて · およぐ → およいで"], ["す → して", "はなす → はなして"], ["る (Gruppe 2) → て", "たべる → たべて"], ["する → して · くる → きて · いく → いって", "Ausnahmen"]], [
    ["ちょっと / 待{ま}って ください 。", "Chotto matte kudasai.", "Bitte warte kurz."],
    ["ここ に / 名前{なまえ} を / 書{か}いて ください 。", "Koko ni namae o kaite kudasai.", "Bitte schreib hier deinen Namen."],
    ["ゆっくり / 話{はな}して ください 。", "Yukkuri hanashite kudasai.", "Bitte sprich langsam."],
    ["窓{まど} を / 開{あ}けて ください 。", "Mado o akete kudasai.", "Bitte mach das Fenster auf."],
    ["電気{でんき} を / 消{け}して ください 。", "Denki o keshite kudasai.", "Bitte schalte das Licht aus."],
    ["もう いちど / 言{い}って ください 。", "Mō ichido itte kudasai.", "Bitte sag es noch einmal."],
  ], [
    { t: "mc", s: "ちょっと ＿ ください。", opts: ["まって", "まちて", "まいて", "まんで"], a: "まって", ro: "Chotto matte kudasai.", de: "Bitte warte kurz." },
    { t: "mc", s: "この ほんを ＿ ください。", opts: ["よんで", "よみて", "よって", "よいて"], a: "よんで", ro: "Kono hon o yonde kudasai.", de: "Bitte lies dieses Buch." },
    { t: "mc", s: "なまえを ＿ ください。", opts: ["かいて", "かって", "かきて", "かんで"], a: "かいて", ro: "Namae o kaite kudasai.", de: "Bitte schreib deinen Namen." },
    { t: "mc", s: "まどを ＿ ください。", opts: ["あけて", "あけって", "あいて", "あけんで"], a: "あけて", ro: "Mado o akete kudasai.", de: "Bitte mach das Fenster auf." },
    { t: "mc", s: "あした また ＿ ください。", opts: ["きて", "くって", "こって", "きって"], a: "きて", ro: "Ashita mata kite kudasai.", de: "Bitte komm morgen wieder." },
    { t: "build", src: "でんき を / けして ください 。", ro: "Denki o keshite kudasai.", de: "Bitte schalte das Licht aus." },
  ]),
  G("teiru", "⏳", "～ている – gerade / Zustand", "みて います", "N5", [
    "て-Form + います beschreibt, was gerade passiert (Verlaufsform): いま テレビを みて います。(Ich schaue gerade fern.)",
    "Es beschreibt auch Zustände: けっこんして います (ist verheiratet), ウィーンに すんで います (wohnt in Wien), しって います (weiß / kennt).",
    "Verneinung: ～て いません – z. B. まだ たべて いません (habe noch nicht gegessen). Vergangenheit: ～て いました. Achtung: „weiß nicht“ heißt しりません.",
  ], [["～て います", "gerade dabei / Zustand"], ["～て いません", "nicht (gerade) / noch nicht"], ["～て いました", "war gerade dabei"], ["しって います · しりません", "weiß · weiß nicht"]], [
    ["今{いま} / 雨{あめ} が / ふって います 。", "Ima ame ga futte imasu.", "Gerade regnet es."],
    ["母{はは} は / 料理{りょうり} を / して います 。", "Haha wa ryōri o shite imasu.", "Meine Mutter kocht gerade."],
    ["ウィーン に / 住{す}んで います 。", "Wīn ni sunde imasu.", "Ich wohne in Wien."],
    ["姉{あね} は / 結婚{けっこん} して います 。", "Ane wa kekkon shite imasu.", "Meine ältere Schwester ist verheiratet."],
    ["まだ / 食{た}べて いません 。", "Mada tabete imasen.", "Ich habe noch nicht gegessen."],
    ["田中{たなか} さん を / 知{し}って います か 。", "Tanaka-san o shitte imasu ka.", "Kennst du Herrn Tanaka?"],
  ], [
    { t: "mc", s: "いま テレビを ＿ います。", opts: ["みて", "みって", "みんで", "みいて"], a: "みて", ro: "Ima terebi o mite imasu.", de: "Ich schaue gerade fern." },
    { t: "mc", s: "ウィーンに ＿ います。", opts: ["すんで", "すみて", "すって", "すいて"], a: "すんで", ro: "Wīn ni sunde imasu.", de: "Ich wohne in Wien." },
    { t: "mc", s: "まだ ＿。", opts: ["たべて いません", "たべて います", "たべました", "たべて いました"], a: "たべて いません", ro: "Mada tabete imasen.", de: "Ich habe noch nicht gegessen." },
    { t: "mc", s: "たなかさんの でんわばんごうを ＿か。", opts: ["しって います", "しります", "しって いました", "しらない"], a: "しって います", ro: "Tanaka-san no denwa bangō o shitte imasu ka.", de: "Weißt du die Telefonnummer von Herrn Tanaka?" },
    { t: "build", src: "あね は / けっこん して います 。", ro: "Ane wa kekkon shite imasu.", de: "Meine ältere Schwester ist verheiratet." },
  ]),
];

/** Lernpfad nach den Kana: Basis-Wörter, dann abwechselnd Grammatik und passende Wortschatz-Themen. */
export const PATH_ORDER = [
  "w:Begrüßung", "w:Zahlen",
  "g:desu", "w:Familie & Leute", "g:ka", "w:Fragewörter", "g:no", "w:Alltag & Orte", "g:kosoado", "w:Einkaufen & Geld",
  "g:mo", "w:Essen & Trinken", "g:aru", "w:Wohnung & Haus", "g:masu", "w:Verben", "g:wo", "w:Häufige Verben",
  "g:ni", "w:Zeit", "w:Zeitangaben", "g:de", "w:Stadt & Verkehr", "g:to", "w:Freizeit & Hobbys", "g:kara", "w:Schule & Lernen",
  "g:iadj", "w:Eigenschaften", "g:naadj", "w:Gefühle & Adjektive", "g:waga", "w:Körper & Gesundheit", "g:mashou", "w:Kleidung",
  "g:counter", "w:Farben & Wetter", "w:Wetter & Jahreszeiten", "g:tai", "w:Natur & Tiere", "g:te", "w:Arbeit & Werkzeug", "w+:Arbeit & Werkzeug",
  "g:teiru", "w+:Familie & Leute",
];
