'use strict';
/* ============================================================
   ПОЛИТИКА: идеологии, правительства, выборы, вмешательство.

   У каждой страны есть c.pol:
     ide     — правящая идеология;  leader — глава власти (или null);
     pop     — популярность идеологий в обществе, % (в сумме 100);
     base    — «естественная» популярность: общество медленно к ней возвращается;
     next    — день ближайших выборов (null — выборов нет); every — раз в сколько лет;
     managed — управляемые выборы: власть побеждает, пока у неё не меньше 30%;
     cands   — кандидаты от идеологий (реальные политики);
     sup     — иностранная поддержка партий [{ by, ide, days }];
     helped  — какие державы помогали этой стране (влияет на выбор блока).
   Держава игрока живёт политикой своей столицы (RUS, USA, CHN).
   Смена правящей идеологии меняет бонусы державы и может развернуть
   страну к другому блоку: близкие по духу режимы тянутся друг к другу.
   ============================================================ */

const IDEOLOGIES = {
  lib:  { name: 'Либералы',         gov: 'Либеральная демократия',     color: '#3f8cff', group: 'dem',
          fx: { rp: 0.08, influence: 0.15, tensionDecay: 1.5 }, fxText: '+8% ОИ · влияние дешевле на 15% · напряжённость спадает в 1,5 раза быстрее' },
  con:  { name: 'Консерваторы',     gov: 'Консервативная демократия',  color: '#7563d8', group: 'dem',
          fx: { pp: 0.3, defense: 0.05 }, fxText: '+0,3 ПВ в день · оборона армий +5%' },
  soc:  { name: 'Социалисты',       gov: 'Социал-демократия',          color: '#e0567c', group: 'dem',
          fx: { rp: 0.05, pp: 0.15, mpMult: 0.1 }, fxText: '+5% ОИ · +0,15 ПВ в день · призыв +10%' },
  com:  { name: 'Коммунисты',       gov: 'Социалистическое государство', color: '#d01c1c', group: 'aut',
          fx: { mpMult: 0.25, factoryEvery: 45 }, fxText: 'призыв +25% · +1 завод каждые 45 дней' },
  auth: { name: 'Государственники', gov: 'Режим сильной власти',       color: '#b07d2a', group: 'aut',
          fx: { pp: 0.4, spyChance: 0.1 }, fxText: '+0,4 ПВ в день · успех тайных операций +10%' },
  nat:  { name: 'Националисты',     gov: 'Национальное государство',   color: '#6b717c', group: 'aut',
          fx: { attackBonus: 0.05, justify: 0.15 }, fxText: 'атака +5% · обоснование войны дешевле на 15%' },
  theo: { name: 'Теократы',         gov: 'Теократия',                  color: '#2f9a5c', group: 'aut',
          fx: { mpMult: 0.15, defense: 0.05 }, fxText: 'призыв +15% · оборона армий +5%' }
};
const IDE_KEYS = Object.keys(IDEOLOGIES);

/* Популярность идеологий по умолчанию — от правящей идеологии */
const POP_TEMPLATES = {
  lib:  { lib: 36, con: 27, soc: 18, nat: 10, com: 4, auth: 5 },
  con:  { con: 36, lib: 24, soc: 20, nat: 12, com: 4, auth: 4 },
  soc:  { soc: 36, con: 27, lib: 18, nat: 10, com: 6, auth: 3 },
  com:  { com: 62, soc: 10, lib: 10, nat: 10, auth: 8 },
  auth: { auth: 56, lib: 12, com: 10, nat: 12, soc: 10 },
  nat:  { nat: 40, con: 24, lib: 16, soc: 12, auth: 8 },
  theo: { theo: 58, lib: 16, con: 12, nat: 8, auth: 6 }
};

/* Правительства на 1 января 2018 года.
   [идеология, лидер, ближайшие выборы, раз в N лет, 'm' — управляемые выборы, кандидаты, популярность]
   Кандидат той же идеологии, что и власть, — преемник: он сменит лидера, если партия власти победит. */
const GOV_2018 = {
  RUS: ['auth', 'Владимир Путин', '2018-03-18', 6, 'm', { com: 'Геннадий Зюганов', nat: 'Владимир Жириновский', lib: 'Алексей Навальный', soc: 'Сергей Миронов' },
        { auth: 60, com: 14, nat: 11, lib: 9, soc: 6 }],
  USA: ['con', 'Дональд Трамп', '2020-11-03', 4, '', { con: 'Дональд Трамп', lib: 'Джо Байден', soc: 'Берни Сандерс', nat: 'Стив Бэннон' },
        { con: 45, lib: 42, soc: 8, nat: 5 }],
  CHN: ['com', 'Си Цзиньпин', '', 0, '', { soc: 'Ли Кэцян', nat: 'Чжан Юся', lib: 'Ван Ян' }, { com: 70, soc: 12, nat: 10, lib: 8 }],
  GBR: ['con', 'Тереза Мэй', '2019-12-12', 5, '', { con: 'Борис Джонсон', soc: 'Джереми Корбин', nat: 'Найджел Фарадж', lib: 'Джо Суинсон' },
        { con: 40, soc: 36, lib: 11, nat: 10, com: 1, auth: 2 }],
  FRA: ['lib', 'Эмманюэль Макрон', '2022-04-10', 5, '', { nat: 'Марин Ле Пен', soc: 'Жан-Люк Меланшон', con: 'Валери Пекресс' },
        { lib: 32, nat: 24, soc: 21, con: 17, com: 3, auth: 3 }],
  DEU: ['con', 'Ангела Меркель', '2021-09-26', 4, '', { con: 'Армин Лашет', soc: 'Олаф Шольц', lib: 'Анналена Бербок', nat: 'Алис Вайдель' },
        { con: 33, soc: 26, lib: 20, nat: 13, com: 6, auth: 2 }],
  ITA: ['soc', 'Паоло Джентилони', '2018-03-04', 5, '', { nat: 'Маттео Сальвини', lib: 'Джузеппе Конте', con: 'Сильвио Берлускони' },
        { lib: 30, soc: 23, nat: 20, con: 17, com: 4, auth: 6 }],
  JPN: ['con', 'Синдзо Абэ', '2021-10-31', 4, '', { con: 'Фумио Кисида', lib: 'Юкио Эдано' }, { con: 46, lib: 30, soc: 12, nat: 8, com: 4 }],
  IND: ['con', 'Нарендра Моди', '2019-04-11', 5, '', { soc: 'Рахул Ганди' }, { con: 44, soc: 32, lib: 10, nat: 8, com: 6 }],
  BRA: ['con', 'Мишел Темер', '2018-10-07', 4, '', { nat: 'Жаир Болсонару', soc: 'Луис Инасиу Лула да Силва', lib: 'Марина Силва' },
        { nat: 32, soc: 31, con: 16, lib: 15, com: 3, auth: 3 }],
  CAN: ['lib', 'Джастин Трюдо', '2019-10-21', 4, '', { con: 'Эндрю Шир', soc: 'Джагмит Сингх' }, { lib: 38, con: 35, soc: 18, nat: 6, com: 3 }],
  AUS: ['con', 'Малкольм Тёрнбулл', '2019-05-18', 3, '', { con: 'Скотт Моррисон', soc: 'Энтони Албаниз' }, { con: 40, soc: 38, lib: 12, nat: 10 }],
  KOR: ['lib', 'Мун Чжэ Ин', '2022-03-09', 5, '', { con: 'Юн Сок Ёль' }, { lib: 45, con: 38, soc: 10, nat: 7 }],
  TUR: ['con', 'Реджеп Тайип Эрдоган', '2018-06-24', 5, 'm', { soc: 'Мухаррем Индже', nat: 'Мераль Акшенер' }, { con: 50, soc: 24, nat: 14, lib: 8, auth: 4 }],
  UKR: ['con', 'Пётр Порошенко', '2019-03-31', 5, '', { lib: 'Владимир Зеленский', soc: 'Юлия Тимошенко', auth: 'Юрий Бойко', nat: 'Олег Тягнибок' },
        { lib: 30, con: 22, soc: 18, auth: 16, nat: 10, com: 4 }],
  POL: ['con', 'Матеуш Моравецкий', '2019-10-13', 4, '', { lib: 'Дональд Туск', nat: 'Кшиштоф Босак' }, { con: 42, lib: 34, soc: 12, nat: 10, com: 2 }],
  HUN: ['con', 'Виктор Орбан', '2018-04-08', 4, '', { nat: 'Габор Вона', soc: 'Гергей Карачонь' }, { con: 48, nat: 20, soc: 18, lib: 12, com: 2 }],
  ESP: ['con', 'Мариано Рахой', '2019-04-28', 4, '', { soc: 'Педро Санчес', lib: 'Альберт Ривера', nat: 'Сантьяго Абаскаль' },
        { soc: 30, con: 29, lib: 18, nat: 12, com: 11 }],
  MEX: ['con', 'Энрике Пенья Ньето', '2018-07-01', 6, '', { soc: 'Андрес Мануэль Лопес Обрадор', lib: 'Рикардо Анайя' }, { soc: 44, lib: 24, con: 22, nat: 6, com: 4 }],
  ARG: ['con', 'Маурисио Макри', '2019-10-27', 4, '', { soc: 'Альберто Фернандес', nat: 'Хавьер Милей' }, { soc: 40, con: 38, lib: 10, nat: 8, com: 4 }],
  IRN: ['theo', 'Али Хаменеи', '2021-06-18', 4, 'm', { lib: 'Мир-Хосейн Мусави' }, { theo: 52, lib: 28, con: 10, nat: 6, auth: 4 }],
  SAU: ['theo', 'Салман ибн Абдул-Азиз', '', 0, '', {}, { theo: 66, auth: 14, lib: 10, nat: 10 }],
  ISR: ['con', 'Биньямин Нетаньяху', '2019-04-09', 4, '', { lib: 'Бени Ганц', soc: 'Ави Габай', nat: 'Нафтали Беннет' }, { con: 36, lib: 30, nat: 18, soc: 12, theo: 4 }],
  EGY: ['auth', 'Абдель Фаттах ас-Сиси', '2018-03-26', 6, 'm', { lib: 'Мохаммед эль-Барадеи' }, { auth: 58, theo: 18, lib: 14, soc: 10 }],
  SYR: ['auth', 'Башар Асад', '2021-05-26', 7, 'm', { theo: 'Оппозиционная коалиция' }, { auth: 50, theo: 28, lib: 12, com: 10 }],
  PRK: ['com', 'Ким Чен Ын', '', 0, '', {}, { com: 92, auth: 8 }],
  CUB: ['com', 'Рауль Кастро', '', 0, '', { com: 'Мигель Диас-Канель' }, { com: 72, lib: 18, soc: 10 }],
  VEN: ['soc', 'Николас Мадуро', '2018-05-20', 6, 'm', { lib: 'Хуан Гуайдо' }, { soc: 40, lib: 38, con: 14, com: 8 }],
  BLR: ['auth', 'Александр Лукашенко', '2020-08-09', 5, 'm', { lib: 'Светлана Тихановская' }, { auth: 54, lib: 28, com: 8, nat: 6, soc: 4 }],
  KAZ: ['auth', 'Нурсултан Назарбаев', '2019-06-09', 5, 'm', { auth: 'Касым-Жомарт Токаев', lib: 'Мухтар Аблязов' }, { auth: 64, lib: 16, nat: 10, com: 10 }],
  UZB: ['auth', 'Шавкат Мирзиёев', '2021-10-24', 5, 'm', {}, { auth: 70, lib: 12, theo: 10, nat: 8 }],
  TJK: ['auth', 'Эмомали Рахмон', '2020-10-11', 7, 'm', {}, { auth: 72, theo: 16, lib: 12 }],
  TKM: ['auth', 'Гурбангулы Бердымухамедов', '2022-03-12', 5, 'm', { auth: 'Сердар Бердымухамедов' }, { auth: 84, lib: 8, nat: 8 }],
  KGZ: ['con', 'Сооронбай Жээнбеков', '2021-01-10', 6, 'm', { nat: 'Садыр Жапаров' }, { con: 42, nat: 30, lib: 14, auth: 14 }],
  ARM: ['con', 'Серж Саргсян', '2018-12-09', 5, '', { lib: 'Никол Пашинян' }, { lib: 36, con: 32, auth: 16, nat: 10, soc: 6 }],
  AZE: ['auth', 'Ильхам Алиев', '2018-04-11', 7, 'm', {}, { auth: 72, nat: 14, lib: 14 }],
  GEO: ['con', 'Георгий Квирикашвили', '2020-10-31', 4, '', { con: 'Ираклий Гарибашвили', lib: 'Ника Мелия' }, { con: 44, lib: 32, nat: 12, auth: 12 }],
  MDA: ['soc', 'Игорь Додон', '2020-11-01', 4, '', { lib: 'Майя Санду' }, { soc: 38, lib: 36, con: 14, com: 12 }],
  MNG: ['soc', 'Ухнаагийн Хурэлсух', '2021-06-09', 4, '', { con: 'Халтмаагийн Баттулга' }, { soc: 46, con: 36, nat: 10, lib: 8 }],
  VNM: ['com', 'Нгуен Фу Чонг', '', 0, '', {}, { com: 76, lib: 14, nat: 10 }],
  LAO: ['com', 'Буннянг Ворачит', '', 0, '', {}, { com: 82, lib: 10, auth: 8 }],
  KHM: ['auth', 'Хун Сен', '2018-07-29', 5, 'm', { auth: 'Хун Манет', lib: 'Кем Сокха' }, { auth: 58, lib: 30, soc: 12 }],
  THA: ['auth', 'Прают Чан-оча', '2019-03-24', 4, 'm', { lib: 'Пита Лимджароенрат', soc: 'Йинглак Чиннават' }, { auth: 40, lib: 28, soc: 22, con: 10 }],
  MMR: ['lib', 'Аун Сан Су Чжи', '2020-11-08', 5, '', { auth: 'Мин Аун Хлайн' }, { lib: 58, auth: 26, nat: 10, soc: 6 }],
  MYS: ['con', 'Наджиб Разак', '2018-05-09', 5, 'm', { lib: 'Махатхир Мохамад', theo: 'Абдул Хади Аванг' }, { lib: 38, con: 34, theo: 18, soc: 10 }],
  IDN: ['lib', 'Джоко Видодо', '2019-04-17', 5, '', { con: 'Прабово Субианто' }, { lib: 50, con: 38, theo: 8, nat: 4 }],
  PHL: ['nat', 'Родриго Дутерте', '2022-05-09', 6, '', { con: 'Фердинанд Маркос-младший', lib: 'Лени Робредо' }, { nat: 40, con: 28, lib: 26, soc: 6 }],
  PAK: ['con', 'Шахид Хакан Аббаси', '2018-07-25', 5, '', { nat: 'Имран Хан', soc: 'Билавал Бхутто Зардари' }, { nat: 34, con: 30, soc: 18, theo: 12, lib: 6 }],
  AFG: ['lib', 'Ашраф Гани', '2019-09-28', 5, '', { con: 'Абдулла Абдулла', theo: 'Хайбатулла Ахундзада' }, { lib: 38, con: 24, theo: 30, nat: 8 }],
  IRQ: ['con', 'Хайдер аль-Абади', '2018-05-12', 4, '', { theo: 'Муктада ас-Садр', con: 'Мустафа аль-Казыми' }, { theo: 34, con: 32, lib: 14, nat: 12, soc: 8 }],
  LKA: ['con', 'Майтрипала Сирисена', '2019-11-16', 5, '', { nat: 'Готабая Раджапакса', soc: 'Саджит Премадаса' }, { nat: 40, con: 30, soc: 22, lib: 8 }],
  BGD: ['soc', 'Шейх Хасина', '2018-12-30', 5, 'm', { con: 'Халеда Зия' }, { soc: 52, con: 30, theo: 12, lib: 6 }],
  TWN: ['lib', 'Цай Инвэнь', '2020-01-11', 4, '', { con: 'Хань Гоюй', lib: 'Лай Циндэ' }, { lib: 48, con: 40, soc: 6, nat: 6 }],
  NLD: ['lib', 'Марк Рютте', '2021-03-17', 4, '', { nat: 'Герт Вилдерс', soc: 'Франс Тиммерманс' }, { lib: 30, con: 22, nat: 18, soc: 20, com: 4, theo: 6 }],
  BEL: ['lib', 'Шарль Мишель', '2019-05-26', 5, '', { nat: 'Барт де Вевер', soc: 'Элио Ди Рупо' }, { lib: 28, nat: 26, soc: 24, con: 18, com: 4 }],
  SWE: ['soc', 'Стефан Лёвен', '2018-09-09', 4, '', { con: 'Ульф Кристерссон', nat: 'Йимми Окессон' }, { soc: 34, con: 28, nat: 18, lib: 12, com: 8 }],
  NOR: ['con', 'Эрна Сульберг', '2021-09-13', 4, '', { soc: 'Йонас Гар Стёре' }, { con: 36, soc: 36, nat: 14, lib: 10, com: 4 }],
  FIN: ['lib', 'Юха Сипиля', '2019-04-14', 4, '', { soc: 'Санна Марин', nat: 'Юсси Халла-ахо', con: 'Петтери Орпо' }, { soc: 30, con: 28, lib: 20, nat: 18, com: 4 }],
  DNK: ['lib', 'Ларс Лёкке Расмуссен', '2019-06-05', 4, '', { soc: 'Метте Фредериксен', nat: 'Кристиан Тулесен Даль' }, { soc: 32, lib: 30, nat: 18, con: 14, com: 6 }],
  AUT: ['con', 'Себастьян Курц', '2019-09-29', 5, '', { nat: 'Норберт Хофер', soc: 'Памела Ренди-Вагнер' }, { con: 36, nat: 26, soc: 26, lib: 12 }],
  CZE: ['con', 'Андрей Бабиш', '2021-10-09', 4, '', { lib: 'Петр Фиала', nat: 'Томио Окамура' }, { con: 34, lib: 30, nat: 14, soc: 12, com: 10 }],
  SVK: ['soc', 'Роберт Фицо', '2020-02-29', 4, '', { con: 'Игор Матович', lib: 'Михал Шимечка' }, { soc: 30, con: 30, lib: 20, nat: 14, com: 6 }],
  ROU: ['soc', 'Виорика Дэнчилэ', '2020-12-06', 4, '', { con: 'Лудовик Орбан', nat: 'Джордже Симион' }, { soc: 38, con: 34, lib: 16, nat: 12 }],
  BGR: ['con', 'Бойко Борисов', '2021-04-04', 4, '', { soc: 'Корнелия Нинова', lib: 'Кирил Петков' }, { con: 36, soc: 28, lib: 18, nat: 12, auth: 6 }],
  GRC: ['soc', 'Алексис Ципрас', '2019-07-07', 4, '', { con: 'Кириакос Мицотакис', nat: 'Никос Михалолиакос' }, { con: 38, soc: 32, com: 10, nat: 10, lib: 10 }],
  PRT: ['soc', 'Антониу Кошта', '2019-10-06', 4, '', { con: 'Руй Рио', nat: 'Андре Вентура' }, { soc: 40, con: 30, com: 12, lib: 10, nat: 8 }],
  SRB: ['con', 'Александр Вучич', '2020-06-21', 4, 'm', { lib: 'Драган Джилас' }, { con: 52, lib: 18, nat: 16, soc: 14 }],
  IRL: ['con', 'Лео Варадкар', '2020-02-08', 5, '', { soc: 'Мэри Лу Макдональд', lib: 'Михол Мартин' }, { con: 44, soc: 34, lib: 16, nat: 6 }],
  NZL: ['soc', 'Джасинда Ардерн', '2020-10-17', 3, '', { con: 'Джудит Коллинз' }, { soc: 44, con: 40, lib: 10, nat: 6 }],
  CHL: ['con', 'Себастьян Пиньера', '2021-11-21', 4, '', { soc: 'Габриэль Борич', nat: 'Хосе Антонио Каст' }, { con: 36, soc: 34, nat: 14, lib: 10, com: 6 }],
  COL: ['lib', 'Хуан Мануэль Сантос', '2018-05-27', 4, '', { con: 'Иван Дуке', soc: 'Густаво Петро' }, { con: 38, soc: 30, lib: 26, nat: 6 }],
  PER: ['con', 'Педро Пабло Кучински', '2021-04-11', 5, '', { soc: 'Педро Кастильо', nat: 'Кейко Фухимори' }, { con: 30, soc: 28, nat: 24, lib: 18 }],
  BOL: ['soc', 'Эво Моралес', '2019-10-20', 5, 'm', { lib: 'Карлос Меса', soc: 'Луис Арсе' }, { soc: 46, lib: 34, con: 14, nat: 6 }],
  ECU: ['soc', 'Ленин Морено', '2021-04-11', 4, '', { con: 'Гильермо Лассо' }, { soc: 40, con: 38, lib: 14, nat: 8 }],
  NIC: ['soc', 'Даниэль Ортега', '2021-11-07', 5, 'm', { lib: 'Кристиана Чаморро' }, { soc: 54, lib: 30, con: 16 }],
  URY: ['soc', 'Табаре Васкес', '2019-10-27', 5, '', { con: 'Луис Лакалье Поу' }, { soc: 44, con: 42, lib: 10, nat: 4 }],
  PRY: ['con', 'Орасио Картес', '2018-04-22', 5, '', { con: 'Марио Абдо Бенитес', lib: 'Эфраин Алегре' }, { con: 50, lib: 36, soc: 14 }],
  ZAF: ['soc', 'Джейкоб Зума', '2019-05-08', 5, '', { soc: 'Сирил Рамафоса', lib: 'Мусси Маймане', com: 'Джулиус Малема' }, { soc: 54, lib: 24, com: 12, nat: 6, con: 4 }],
  NGA: ['con', 'Мухаммаду Бухари', '2019-02-23', 4, '', { lib: 'Атику Абубакар', con: 'Бола Тинубу' }, { con: 48, lib: 42, theo: 6, soc: 4 }],
  ETH: ['soc', 'Хайлемариам Десалень', '2021-06-21', 5, 'm', { soc: 'Абий Ахмед' }, { soc: 56, lib: 22, nat: 22 }],
  KEN: ['con', 'Ухуру Кениата', '2022-08-09', 5, '', { con: 'Уильям Руто', soc: 'Раила Одинга' }, { con: 50, soc: 44, lib: 6 }],
  TZA: ['con', 'Джон Магуфули', '2020-10-28', 5, 'm', { lib: 'Тунду Лиссу' }, { con: 62, lib: 30, soc: 8 }],
  DZA: ['auth', 'Абдельазиз Бутефлика', '2019-12-12', 5, 'm', { auth: 'Абдельмаджид Теббун', lib: 'Карим Табу', theo: 'Абдерразак Макри' }, { auth: 46, lib: 26, theo: 20, soc: 8 }],
  MAR: ['con', 'Мухаммед VI', '', 0, '', {}, { con: 52, theo: 22, lib: 16, soc: 10 }],
  TUN: ['lib', 'Беджи Каид Эс-Себси', '2019-10-13', 5, '', { nat: 'Кайс Саид', theo: 'Рашид Ганнуши' }, { lib: 30, nat: 28, theo: 26, soc: 16 }],
  SDN: ['auth', 'Омар аль-Башир', '2020-04-02', 5, 'm', { lib: 'Абдалла Хамдок', auth: 'Абдель Фаттах аль-Бурхан' }, { auth: 40, lib: 32, theo: 20, com: 8 }],
  ZWE: ['auth', 'Эммерсон Мнангагва', '2018-07-30', 5, 'm', { lib: 'Нельсон Чамиса' }, { auth: 50, lib: 42, soc: 8 }],
  COD: ['auth', 'Жозеф Кабила', '2018-12-30', 5, 'm', { lib: 'Феликс Чисекеди' }, { auth: 34, lib: 50, con: 16 }],
  AGO: ['soc', 'Жуан Лоренсу', '2022-08-24', 5, 'm', { con: 'Адалберту Кошта Жуниор' }, { soc: 54, con: 40, lib: 6 }],
  UGA: ['auth', 'Йовери Мусевени', '2021-01-14', 5, 'm', { lib: 'Бобби Вайн' }, { auth: 56, lib: 38, con: 6 }],
  RWA: ['auth', 'Поль Кагаме', '2024-07-15', 7, 'm', {}, { auth: 80, lib: 12, soc: 8 }],
  CMR: ['auth', 'Поль Бийя', '2018-10-07', 7, 'm', { lib: 'Морис Камто' }, { auth: 60, lib: 30, nat: 10 }],
  GHA: ['con', 'Нана Акуфо-Аддо', '2020-12-07', 4, '', { soc: 'Джон Драмани Махама' }, { con: 50, soc: 46, lib: 4 }],
  SEN: ['lib', 'Маки Салл', '2019-02-24', 5, '', { soc: 'Усман Сонко' }, { lib: 52, soc: 36, theo: 12 }],
  CIV: ['lib', 'Алассан Уаттара', '2020-10-31', 5, 'm', { con: 'Анри Конан Бедье' }, { lib: 54, con: 34, soc: 12 }],
  LBY: ['con', 'Файез ас-Сарадж', '', 0, '', { auth: 'Халифа Хафтар' }, { con: 32, auth: 34, theo: 26, nat: 8 }],
  YEM: ['con', 'Абд Раббо Мансур Хади', '', 0, '', { theo: 'Абдул-Малик аль-Хуси' }, { con: 30, theo: 46, soc: 14, nat: 10 }],
  JOR: ['con', 'Абдалла II', '', 0, '', {}, { con: 58, theo: 24, lib: 18 }],
  LBN: ['con', 'Мишель Аун', '2018-05-06', 4, '', { theo: 'Хасан Насралла' }, { con: 34, theo: 32, lib: 20, soc: 14 }],
  PSX: ['con', 'Махмуд Аббас', '', 0, '', { theo: 'Исмаил Хания' }, { con: 44, theo: 40, soc: 16 }],
  QAT: ['auth', 'Тамим бин Хамад Аль Тани', '', 0, '', {}, { auth: 74, theo: 16, lib: 10 }],
  ARE: ['auth', 'Халифа ибн Заид Аль Нахайян', '', 0, '', { auth: 'Мухаммед бин Заид Аль Нахайян' }, { auth: 78, theo: 12, lib: 10 }],
  KWT: ['auth', 'Сабах аль-Ахмед аль-Джабер ас-Сабах', '', 0, '', {}, { auth: 60, theo: 20, lib: 20 }],
  OMN: ['auth', 'Кабус бен Саид', '', 0, '', { auth: 'Хайсам бен Тарик' }, { auth: 78, theo: 12, lib: 10 }],
  CHE: ['lib', 'Ален Берсе', '2019-10-20', 4, '', { nat: 'Альберт Рёсти', con: 'Игнацио Кассис' }, { nat: 28, lib: 26, soc: 24, con: 18, com: 4 }],
  HRV: ['con', 'Андрей Пленкович', '2020-07-05', 4, '', { soc: 'Давор Бернардич' }, { con: 40, soc: 32, lib: 14, nat: 14 }],
  SVN: ['lib', 'Миро Церар', '2018-06-03', 4, '', { con: 'Янез Янша', lib: 'Роберт Голоб' }, { con: 30, lib: 34, soc: 22, nat: 8, com: 6 }],
  EST: ['soc', 'Юри Ратас', '2019-03-03', 4, '', { lib: 'Кая Каллас', nat: 'Март Хельме' }, { lib: 32, soc: 26, nat: 18, con: 14, auth: 10 }],
  LVA: ['con', 'Марис Кучинскис', '2018-10-06', 4, '', { lib: 'Кришьянис Кариньш', auth: 'Нил Ушаков' }, { con: 30, lib: 26, auth: 22, nat: 16, soc: 6 }],
  LTU: ['lib', 'Саулюс Сквернялис', '2020-10-11', 4, '', { con: 'Ингрида Шимоните' }, { lib: 34, con: 34, soc: 20, nat: 12 }],
  ALB: ['soc', 'Эди Рама', '2021-04-25', 4, '', { con: 'Лулзим Баша' }, { soc: 50, con: 40, lib: 10 }],
  MKD: ['soc', 'Зоран Заев', '2020-07-15', 4, '', { nat: 'Христиан Мицкоский' }, { soc: 40, nat: 38, lib: 22 }],
  MNE: ['soc', 'Душко Маркович', '2020-08-30', 4, '', { con: 'Здравко Кривокапич' }, { soc: 42, con: 34, nat: 14, lib: 10 }],
  BIH: ['con', 'Денис Звиздич', '2018-10-07', 4, '', { nat: 'Милорад Додик' }, { con: 34, nat: 34, soc: 20, lib: 12 }],
  CYP: ['con', 'Никос Анастасиадис', '2018-02-04', 5, '', { com: 'Ставрос Малас' }, { con: 50, com: 30, lib: 12, nat: 8 }],
  ISL: ['soc', 'Катрин Якобсдоуттир', '2021-09-25', 4, '', { con: 'Бьярни Бенедиктссон' }, { con: 34, soc: 34, lib: 24, nat: 8 }],
  LUX: ['lib', 'Ксавье Беттель', '2018-10-14', 5, '', { con: 'Клод Визелер' }, { con: 36, lib: 34, soc: 22, nat: 8 }],
  NPL: ['com', 'Кхадга Прасад Шарма Оли', '2022-11-20', 5, '', { soc: 'Шер Бахадур Деуба' }, { com: 48, soc: 36, con: 10, lib: 6 }],
  CYN: ['con', 'Мустафа Акынджи', '', 0, '', {}, { con: 50, nat: 30, lib: 20 }]
};

/* Идеология неизвестных стран по региону (номер дан по коду страны — расстановка не меняется от партии к партии) */
function regionIdeology(id, sub) {
  const h = [...id].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const pick = arr => arr[h % arr.length];
  if (!sub) return 'con';
  if (/Western|Northern|Southern Europe/.test(sub)) return pick(['lib', 'con', 'soc']);
  if (/Eastern Europe/.test(sub)) return pick(['con', 'con', 'soc']);
  if (/America|Caribbean/.test(sub)) return pick(['con', 'soc', 'lib']);
  if (/Western Asia|Northern Africa/.test(sub)) return pick(['auth', 'auth', 'theo']);
  if (/Africa/.test(sub)) return pick(['auth', 'con', 'soc', 'auth']);
  if (/Australia|Melanesia|Polynesia|Micronesia/.test(sub)) return pick(['con', 'lib']);
  return pick(['auth', 'con', 'soc']);
}

const Politics = {
  dayOf(dateStr) { return Math.round((Date.parse(dateStr + 'T00:00:00Z') - CFG.START_DATE) / 86400000); },

  // Привести популярность к сумме 100 (с точностью 0,1)
  normalize(pop) {
    let sum = 0;
    for (const k of Object.keys(pop)) { pop[k] = Math.max(0, pop[k]); sum += pop[k]; }
    if (sum <= 0) return pop;
    for (const k of Object.keys(pop)) {
      pop[k] = Math.round(pop[k] / sum * 1000) / 10;
      if (pop[k] < 0.2) delete pop[k];
    }
    return pop;
  },

  // Правительство страны на старте
  make(id, sub) {
    const d = GOV_2018[id];
    const ide = d ? d[0] : regionIdeology(id, sub);
    let pop;
    if (d && d[6]) pop = Object.assign({}, d[6]);
    else {
      pop = Object.assign({}, POP_TEMPLATES[ide]);
      for (const k of Object.keys(pop)) pop[k] = Math.max(1, pop[k] + U.rand(-4, 4));
    }
    this.normalize(pop);
    const dem = IDEOLOGIES[ide].group === 'dem';
    let next = null, every = 0;
    if (d && d[2]) { next = this.dayOf(d[2]); every = d[3]; }
    else if (!d && dem) { every = 4 + (id.charCodeAt(0) % 2); next = U.randi(60, every * 365); }
    return {
      ide, leader: d ? d[1] : null, title: null, since: 0,
      pop, base: Object.assign({}, pop),
      next, every, managed: d ? d[4] === 'm' : !dem,
      cands: d ? Object.assign({}, d[5]) : {},
      sup: [], helped: {}, meddled: {}, coupCd: {}, succUsed: false
    };
  },

  // Близость идеологий: 2 — одна и та же, 1 — один лагерь (демократии / режимы), 0 — чужие
  affinity(a, b) {
    if (!a || !b) return 1;
    if (a === b) return 2;
    return IDEOLOGIES[a].group === IDEOLOGIES[b].group ? 1 : 0;
  },

  initials(name) {
    if (!name) return '—';
    const w = name.replace(/[«»"]/g, '').split(/\s+/).filter(Boolean);
    return ((w[0] || '')[0] + ((w.length > 1 ? w[w.length - 1] : '')[0] || '')).toUpperCase();
  }
};

/* ---------------- Политический движок (часть Game) ---------------- */
Object.assign(Game, {
  /* --- Чья политика действует на этой земле --- */
  isPowerHome(c) { return !!c && this.isPower(c.ctrl) && POWERS[c.ctrl].capital === c.id; },
  // Страна, чьё правительство управляет землёй c: сама страна, столица державы или оккупант
  govHolder(c) {
    if (!c) return null;
    if (c.ctrl === c.id) return c;
    if (this.isPower(c.ctrl)) return this.c(POWERS[c.ctrl].capital);
    return this.c(c.ctrl) || c;
  },
  gov(c) { const h = this.govHolder(c); return h && h.pol; },
  powerGov(tag = this.cur) { const c = this.c(POWERS[tag].capital); return c && c.pol; },
  powerIde(tag = this.cur) { const g = this.powerGov(tag); return g ? g.ide : null; },
  leaderOf(tag = this.cur) { const g = this.powerGov(tag); return g ? this.leaderLabel(g) : POWERS[tag].leader; },
  leaderTitle(tag = this.cur) {
    const g = this.powerGov(tag);
    return (g && g.title) || POWERS[tag].title;
  },
  leaderLabel(pol) { return pol.leader || `лидер партии «${IDEOLOGIES[pol.ide].name}»`; },
  ideName(ide) { return IDEOLOGIES[ide] ? IDEOLOGIES[ide].name : '—'; },
  // Настоящее название партии этой идеологии в стране (или общее)
  partyName(c, ide) {
    const h = c && this.govHolder(c);
    const id = h ? h.id : null;
    return (id && PARTIES[id] && PARTIES[id][ide]) || GENERIC_PARTIES[ide] || IDEOLOGIES[ide].name;
  },
  // Ближайшие выборы через столько дней (null — выборов нет)
  electionIn(pol) { return pol && pol.next != null ? Math.max(0, pol.next - this.S.day) : null; },

  /* --- Сдвиг популярности: n пунктов идеологии ide, остальные уступают пропорционально --- */
  shiftPop(pol, ide, n) {
    if (!pol || !IDEOLOGIES[ide]) return;
    pol.pop[ide] = Math.max(0, (pol.pop[ide] || 0) + n);
    Politics.normalize(pol.pop);
  },
  // Сдвиг популярности в своей державе (для событий и фокусов)
  addPop(ide, n, tag = this.cur) {
    const pol = this.powerGov(tag);
    if (!pol) return;
    if (ide === 'ruling') ide = pol.ide;
    this.shiftPop(pol, ide, n);
  },

  /* --- Смена власти --- */
  setGov(c, ide, leader, how = 'election', title = null) {
    const pol = c.pol, S = this.S;
    if (!pol || !IDEOLOGIES[ide]) return;
    const old = pol.ide, oldLeader = pol.leader;
    pol.ide = ide;
    pol.leader = leader || null;
    pol.title = title || (ide === old ? pol.title : null);
    pol.since = S.day;
    // Новая власть укрепляется: её идеология становится «естественной» для общества
    if ((pol.pop[ide] || 0) < 40) this.shiftPop(pol, ide, 40 - (pol.pop[ide] || 0));
    pol.base[ide] = (pol.base[ide] || 0) + 18;
    Politics.normalize(pol.base);
    const dem = IDEOLOGIES[ide].group === 'dem';
    if (ide !== old) pol.managed = !dem;
    if (how === 'coup' && !dem) pol.next = null;
    else if (dem && pol.next == null) { pol.every = pol.every || 4; pol.next = S.day + pol.every * 365; }
    this.recalcMods();
    if (ide !== old || leader !== oldLeader) this.onGovChanged(c, old, oldLeader, how);
    Bus.emit('mapDirty');
    Bus.emit('stateChanged');
  },

  onGovChanged(c, oldIde, oldLeader, how) {
    const pol = c.pol;
    const tag = this.isPowerHome(c) ? c.ctrl : null;
    const I = IDEOLOGIES[pol.ide];
    const how2 = { election: 'по итогам выборов', coup: 'в результате переворота', protest: 'после массовых протестов',
      focus: 'по решению руководства страны', event: '', succession: 'в порядке преемственности' }[how] || '';
    if (tag) {
      // Держава игрока: смена курса меняет бонусы, союзники могут отвернуться
      this.popup({
        id: 'sys_gov', art: 'i-flag', cat: 'dip',
        title: pol.ide === oldIde ? 'Новый лидер' : 'Смена власти',
        text: `${how2 ? how2[0].toUpperCase() + how2.slice(1) + ' ' : ''}к власти приходит ${this.leaderLabel(pol)} (${I.name.toLowerCase()}).`
          + (pol.ide !== oldIde ? ` Курс державы меняется: ${I.gov}. Новые бонусы: ${I.fxText}.` : ' Курс державы сохраняется.'),
        options: [{ label: 'Принять', tip: I.fxText, fx: () => {} }]
      }, {}, tag);
      if (pol.ide !== oldIde) this.realignAllies(tag);
    } else {
      this.realign(c, oldIde);
    }
  },

  // Союзники державы сверяют курс: чужой по духу режим может выйти из блока
  realignAllies(tag) {
    const ide = this.powerIde(tag);
    for (const a of this.allies(tag)) {
      if (Politics.affinity(this.gov(a).ide, ide) === 0 && U.chance(0.3)) this.leaveBloc(a, `Курс державы «${POWERS[tag].name}» изменился, и правительство не готово идти следом`);
    }
  },

  // Страна сменила власть: остаться ли в блоке, вступить ли в другой
  realign(c, oldIde) {
    if (c.ctrl !== c.id || c.inert) return;
    const ide = c.pol.ide;
    const blocs = ['WEST', 'COM', 'AXIS', 'GUAM'];
    if (blocs.includes(c.faction)) {
      const lead = this.c(FACTIONS[c.faction].leader);
      const li = lead && this.gov(lead) ? this.gov(lead).ide : null;
      if (Politics.affinity(ide, li) === 0 && U.chance(0.5)) this.leaveBloc(c, 'Новая власть разворачивает внешнюю политику');
      return;
    }
    if (c.faction !== 'NEU' || this.tags().some(t => c.wars[t])) return;
    for (const f of blocs) {
      const lead = this.c(FACTIONS[f].leader);
      if (!lead || lead.ctrl !== lead.id && !this.isPowerHome(lead)) continue;
      if (Politics.affinity(ide, this.gov(lead).ide) !== 2) continue;
      const power = POWER_TAGS.find(t => POWERS[t].allyFaction === f && this.isPower(t));
      const helped = power && c.pol.helped[power] && this.S.day - c.pol.helped[power] < 540;
      if (U.chance(0.12 + (helped ? 0.4 : 0))) { this.setFaction(c.id, f); return; }
    }
  },

  leaveBloc(c, why) {
    const fac = FACTIONS[c.faction];
    c.faction = 'NEU';
    c.integrate = null;
    this.news(`${c.name} выходит из блока «${fac.name}»`, `${why}. Страна объявляет о нейтралитете.`, c.id);
    Bus.emit('mapDirty');
  },

  /* --- Выборы --- */
  holdElection(c) {
    const pol = c.pol, S = this.S;
    const old = pol.ide;
    const votes = {};
    for (const [k, v] of Object.entries(pol.pop)) if (v >= 2) votes[k] = Math.max(0.5, v + U.rand(-5, 5));
    let winner, crisis = false;
    if (pol.managed && votes[old] != null && (pol.pop[old] || 0) + U.rand(-4, 4) >= 30) {
      winner = old;
      votes[old] = Math.max(votes[old], 52 + U.rand(0, 25));
    } else {
      winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
      if (pol.managed && winner !== old) crisis = true;
    }
    const total = Object.values(votes).reduce((s, v) => s + v, 0);
    const share = Math.round(votes[winner] / total * 1000) / 10;
    let leader = pol.leader;
    if (winner !== old) leader = pol.cands[winner] || null;
    else if (pol.cands[winner] && pol.cands[winner] !== pol.leader && !pol.succUsed) { leader = pol.cands[winner]; pol.succUsed = true; }
    pol.next = pol.every ? S.day + Math.round(pol.every * 365) : null;
    pol.meddled = {};
    const changed = winner !== old || leader !== pol.leader;
    const pn = this.partyName(c, winner);
    const party = `партия «${pn}»`;
    const who = leader ? `${leader} («${pn}»)` : `кандидат партии «${pn}»`;
    let text;
    if (crisis) text = `Официальные итоги не признаны: на улицы вышли сотни тысяч человек. Власть переходит к оппозиции — ${who} (${IDEOLOGIES[winner].name.toLowerCase()}).`;
    else if (winner !== old) text = `Побеждает ${who} (${IDEOLOGIES[winner].name.toLowerCase()}) — ${share}% голосов. Страну ждёт смена курса: ${IDEOLOGIES[winner].gov.toLowerCase()}.`;
    else if (changed) text = `Партия власти удерживает большинство (${share}%). Новый лидер — ${who}.`;
    else text = `${leader ? who : party[0].toUpperCase() + party.slice(1)} сохраняет власть: ${share}% голосов.${pol.managed ? ' Оппозиция говорит о нарушениях.' : ''}`;
    this.news(`Выборы: ${c.name}`, text, c.id, 'elections');
    if (this.isPowerHome(c) && !changed) {
      this.popup({
        id: 'sys_reelect', art: 'i-flag', cat: 'dip', title: 'Мандат подтверждён',
        text: `${U.cap(this.leaderLabel(pol))} побеждает на выборах (${share}%). Курс державы сохраняется. Следующие выборы — через ${pol.every} г.`,
        options: [{ label: 'Отлично', tip: '+20 ПВ', fx: () => this.addPP(20) }]
      }, {}, c.ctrl);
    }
    if (changed) this.setGov(c, winner, leader, crisis ? 'protest' : 'election');
  },

  /* --- Ежедневная политика --- */
  tickPolitics() {
    const S = this.S;
    const weekly = S.day % 7 === 0;
    this.eachCountry(c => {
      const pol = c.pol;
      if (!pol || c.inert || c.radioactive) return;
      const self = c.ctrl === c.id, home = this.isPowerHome(c);
      if (!self && !home) {
        if (pol.next != null && S.day >= pol.next) pol.next += 365;   // оккупация: выборы откладываются
        return;
      }
      if (weekly) {
        for (const s of pol.sup) { this.shiftPop(pol, s.ide, 1.1 * (s.k || 1)); s.days -= 7; }
        pol.sup = pol.sup.filter(s => s.days > 0);
        // Общество медленно возвращается к своим привычным взглядам
        for (const k of new Set([...Object.keys(pol.pop), ...Object.keys(pol.base)])) {
          pol.pop[k] = (pol.pop[k] || 0) + ((pol.base[k] || 0) - (pol.pop[k] || 0)) * 0.025;
        }
        Politics.normalize(pol.pop);
        // Затяжная война и проигрыш бьют по власти, высокая напряжённость — на руку националистам
        const war = home ? this.fronts(c.ctrl).length > 0 : this.tags().some(t => c.wars[t]);
        if (war) this.shiftPop(pol, pol.ide, c.control < 60 ? -0.6 : -0.2);
        if (S.tension > 60) this.shiftPop(pol, 'nat', 0.15);
      }
      if (pol.next != null && S.day >= pol.next) this.holdElection(c);
    });
    this.tickWorldNews();
  },

  /* --- Новости --- */
  news(title, text, cid, kind) { this.log('news', title, text, cid, null, kind ? { k: kind } : null); },

  tickWorldNews() {
    const S = this.S;
    for (const n of (typeof WORLD_NEWS !== 'undefined' ? WORLD_NEWS : [])) {
      const key = 'wn_' + n.id;
      if (S.flags[key]) continue;
      const at = Politics.dayOf(n.date);
      if (S.day < at) continue;
      if (n.cond && !n.cond()) { if (S.day > at + 120) S.flags[key] = 'skipped'; continue; }
      S.flags[key] = 1;
      try { n.fx && n.fx(); } catch (e) { console.error('[news]', n.id, e); }
      this.news(n.title, typeof n.text === 'function' ? n.text() : n.text, n.cid || null, n.kind);
    }
    // Исторические события с выбором — сначала мировая новость (и что меняется в мире), затем решения держав
    for (const e of (typeof EVENTS !== 'undefined' ? EVENTS : [])) {
      const key = 'world_' + e.id;
      if (!e.date || S.flags[key]) continue;
      const at = Politics.dayOf(e.date);
      if (S.day < at) continue;
      if (e.cond && !e.cond()) { if (S.day > at + 120) S.flags[key] = 'skipped'; continue; }
      S.flags[key] = 1;
      try {
        if (e.world) e.world();
        if (!e.noNews) this.news(e.title, typeof e.text === 'function' ? e.text({}) : e.text, e.cid || null);
      } catch (err) { console.error('[event world]', e.id, err); }
    }
    if (S.day < (S.nextNewsDay || 4) || typeof RANDOM_NEWS === 'undefined') return;
    S.nextNewsDay = S.day + U.randi(5, 12);
    const pool = this.list(c => c.ctrl === c.id && !c.inert && !c.radioactive && c.pol);
    const c = U.weightedPick(pool, c => 1 + c.factories * 0.4 + (c.pop > 5e7 ? 2 : 0) + (this.isPower(c.ctrl) ? -1 : 0));
    if (!c) return;
    const t = U.weightedPick(RANDOM_NEWS.filter(t => !t.cond || t.cond(c)), t => t.w);
    if (!t) return;
    try { t.fx && t.fx(c); } catch (e) { console.error('[news]', e); }
    this.news(t.title(c), t.text(c), c.id);
  },

  /* --- Национальные духи: временные модификаторы державы (санкции, пандемия…) --- */
  addSpirit(tag, id, name, fx, days, desc) {
    const P = this.P(tag);
    if (!P) return;
    P.spirits = P.spirits || [];
    const old = P.spirits.find(s => s.id === id);
    if (old) { old.days = Math.max(old.days, days); old.fx = fx; return; }
    P.spirits.push({ id, name, fx, days, desc: desc || '' });
    this.recalcMods();
    this.log('info', 'Новый национальный дух', `«${name}»${desc ? ': ' + desc : ''}`, null, tag);
  },
  removeSpirit(tag, id) {
    const P = this.P(tag);
    if (!P || !P.spirits) return;
    P.spirits = P.spirits.filter(s => s.id !== id);
    this.recalcMods();
  },
  tickSpirits() {
    const P = this.P();
    if (!P.spirits || !P.spirits.length) return;
    const gone = [];
    for (const s of P.spirits) if (s.days != null && --s.days <= 0) gone.push(s);
    if (!gone.length) return;
    P.spirits = P.spirits.filter(s => !gone.includes(s));
    this.recalcMods();
    gone.forEach(s => this.log('info', 'Национальный дух исчез', `«${s.name}» больше не действует.`));
  },

  /* --- Влияние: шанс вступления в блок зависит от близости идеологий --- */
  influenceChance(c, tag = this.cur) {
    const base = U.clamp(0.75 - this.S.tension / 250, 0.25, 0.9);
    const fit = Politics.affinity(this.gov(c) && this.gov(c).ide, this.powerIde(tag));
    return U.clamp(base + [-0.2, 0.05, 0.15][fit], 0.1, 0.95);
  },

  /* ============ ДЕЙСТВИЯ: поддержка партии, вмешательство в выборы, переворот ============ */
  polTarget(c) {
    if (!c || c.inert) return 'Здесь нет государства';
    if (c.radioactive) return 'Радиоактивная пустошь';
    if (c.ctrl !== c.id && !this.isPowerHome(c)) return this.isPower(c.ctrl) ? 'Политика державы решается в её столице' : 'Территория под чужим контролем';
    return null;
  },
  supportCost() { return Math.round(CFG.POL.support * (1 - this.mods.influence)); },
  canSupport(c, ide) {
    if (this.outReason()) return this.outReason();
    const t = this.polTarget(c);
    if (t) return t;
    if (!IDEOLOGIES[ide]) return 'Выберите партию';
    if (c.ctrl !== this.cur && this.atWar(c)) return 'Идёт война';
    if (c.pol.sup.some(s => s.by === this.cur)) return 'Наша поддержка уже идёт';
    if (this.P().pp < this.supportCost()) return `Нужно ${this.supportCost()} ПВ`;
    return null;
  },
  supportParty(id, ide) {
    const c = this.c(id), why = this.canSupport(c, ide);
    if (why) return this.fail(why);
    const X = this.cur, own = c.ctrl === X, pp = this.supportCost();
    this.P().pp -= pp;
    c.pol.sup.push({ by: X, ide, days: CFG.POL.supportDays, k: own ? 1.4 : 1 });
    c.pol.helped[X] = this.S.day;
    if (!own) this.addTension(0.5);
    const party = this.partyName(c, ide);
    this.log('dip', own ? 'Агитационная кампания' : 'Поддержка партии',
      own ? `Государственные СМИ и активисты работают на партию «${party}». Срок — ${U.days(CFG.POL.supportDays)}.`
        : `Деньги, СМИ и консультанты работают на партию «${party}». Страна: ${c.name}. Срок — ${U.days(CFG.POL.supportDays)}.`, id);
    if (this.isPowerHome(c) && !own) {
      this.log('alert', 'Иностранное вмешательство', `Спецслужбы фиксируют: держава «${POWERS[X].name}» финансирует партию «${party}» в нашей стране.`, id, c.ctrl);
    }
    Bus.emit('stateChanged');
    return { ok: true, msg: own ? `Агитация за партию «${party}» началась` : `Поддержка партии «${party}» началась` };
  },

  meddleChance(c) {
    return U.clamp(0.65 + this.mods.spyChance - this.S.tension / 400 - (this.isPowerHome(c) && c.ctrl !== this.cur ? 0.2 : 0), 0.15, 0.9);
  },
  canMeddle(c, ide) {
    if (this.outReason()) return this.outReason();
    const t = this.polTarget(c);
    if (t) return t;
    if (!IDEOLOGIES[ide]) return 'Выберите партию';
    const left = this.electionIn(c.pol);
    if (left == null) return 'В стране нет выборов';
    if (left > CFG.POL.meddleWindow) return `До выборов ${U.days(left)} — вмешаться можно за ${CFG.POL.meddleWindow} дн.`;
    if (c.pol.meddled[this.cur]) return 'В этих выборах мы уже участвовали';
    if (this.P().pp < CFG.POL.meddle) return `Нужно ${CFG.POL.meddle} ПВ`;
    return null;
  },
  meddle(id, ide) {
    const c = this.c(id), why = this.canMeddle(c, ide);
    if (why) return this.fail(why);
    const X = this.cur, P = this.P(), party = this.partyName(c, ide);
    P.pp -= CFG.POL.meddle;
    c.pol.meddled[X] = true;
    c.pol.helped[X] = this.S.day;
    if (U.chance(this.meddleChance(c))) {
      P.stats.spyOk++;
      this.shiftPop(c.pol, ide, 7);
      this.log('intel', 'Вмешательство в выборы', `Боты, утечки и «независимые» СМИ сработали: партия «${party}» +7%. Страна: ${c.name}.`, id);
      Bus.emit('stateChanged');
      return { ok: true, msg: `Вмешательство удалось: «${party}» +7%` };
    }
    P.stats.spyFail++;
    this.shiftPop(c.pol, ide, -4);
    this.addTension(3);
    this.log('alert', 'Вмешательство раскрыто', `Журналисты раскрыли нашу сеть. Партия «${party}» теряет 4%, напряжённость +3%. Страна: ${c.name}.`, id);
    this.news(`Скандал на выборах: ${c.name}`, `Расследование выявило иностранное вмешательство. Подозревают державу «${POWERS[X].name}».`, id, 'elections');
    Bus.emit('stateChanged');
    return { ok: true, msg: 'Вмешательство раскрыто', warn: true };
  },

  coupChance(c, ide) {
    const pop = (c.pol.pop[ide] || 0) / 100;
    return U.clamp(0.15 + pop + this.mods.spyChance - (c.major ? 0.15 : 0) - c.fort * 0.03 - this.S.tension / 500, 0.08, 0.75);
  },
  canCoup(c, ide) {
    if (this.outReason()) return this.outReason();
    const t = this.polTarget(c);
    if (t) return t;
    if (this.isPower(c.ctrl)) return 'Против державы-игрока переворот невозможен';
    if (!IDEOLOGIES[ide]) return 'Выберите партию';
    if (ide === c.pol.ide) return 'Эта партия уже у власти';
    if ((c.pol.pop[ide] || 0) < CFG.POL.coupMinPop) return `Нужно, чтобы партию поддерживали ≥${CFG.POL.coupMinPop}% (сейчас ${Math.round(c.pol.pop[ide] || 0)}%)`;
    if ((c.pol.coupCd[this.cur] || 0) > this.S.day) return `Сеть восстанавливается: ${U.days(c.pol.coupCd[this.cur] - this.S.day)}`;
    if (this.P().pp < CFG.POL.coup) return `Нужно ${CFG.POL.coup} ПВ`;
    return null;
  },
  coup(id, ide) {
    const c = this.c(id), why = this.canCoup(c, ide);
    if (why) return this.fail(why);
    const X = this.cur, P = this.P(), I = IDEOLOGIES[ide];
    P.pp -= CFG.POL.coup;
    c.pol.helped[X] = this.S.day;
    c.pol.coupCd[X] = this.S.day + 365;
    if (U.chance(this.coupChance(c, ide))) {
      P.stats.spyOk++;
      this.addTension(3);
      const leader = c.pol.cands[ide] || null;
      this.news(`Переворот: ${c.name}`, `Власть захвачена силами, близкими к партии «${this.partyName(c, ide)}». ${leader ? 'Новый лидер — ' + leader + '.' : 'Сформировано временное правительство.'}`, id, 'elections');
      this.setGov(c, ide, leader, 'coup');
      // Переворот «своих» почти наверняка приводит страну в наш блок
      if (c.faction === 'NEU' && Politics.affinity(ide, this.powerIde(X)) === 2 && U.chance(0.6)) this.setFaction(id, POWERS[X].allyFaction);
      Bus.emit('stateChanged');
      return { ok: true, msg: `Переворот удался: ${c.name}` };
    }
    P.stats.spyFail++;
    this.addTension(5);
    this.shiftPop(c.pol, ide, -6);
    this.news(`Попытка переворота: ${c.name}`, `Мятеж подавлен, заговорщики арестованы. Следы ведут к державе «${POWERS[X].name}».`, id, 'elections');
    Bus.emit('stateChanged');
    return { ok: true, msg: 'Переворот провалился', warn: true };
  }
});
