/**
 * The world's main airports, for "a flight from X to Y" — a fixed table, so
 * the route needs nothing fetched. About two hundred of the busiest international
 * airports by passengers, with every continent represented; positions from
 * OurAirports (public domain), rounded to 0.01° (about a kilometre, against
 * routes thousands long). A place not here is answered by name, not guessed.
 *
 * Row: [IATA, ICAO, name, city, country, lat, lon]
 */

import { editDistance } from "./atlas-intent.js?v=20261024-596d060";

const ROWS = [
  // Europe
  ["LHR", "EGLL", "Heathrow", "London", "GB", 51.47, -0.45],
  ["LGW", "EGKK", "Gatwick", "London", "GB", 51.15, -0.19],
  ["STN", "EGSS", "Stansted", "London", "GB", 51.88, 0.24],
  ["MAN", "EGCC", "Manchester", "Manchester", "GB", 53.35, -2.27],
  ["EDI", "EGPH", "Edinburgh", "Edinburgh", "GB", 55.95, -3.37],
  ["DUB", "EIDW", "Dublin", "Dublin", "IE", 53.42, -6.27],
  ["CDG", "LFPG", "Charles de Gaulle", "Paris", "FR", 49.01, 2.55],
  ["ORY", "LFPO", "Orly", "Paris", "FR", 48.72, 2.38],
  ["NCE", "LFMN", "Côte d'Azur", "Nice", "FR", 43.66, 7.22],
  ["AMS", "EHAM", "Schiphol", "Amsterdam", "NL", 52.31, 4.76],
  ["BRU", "EBBR", "Brussels", "Brussels", "BE", 50.90, 4.48],
  ["FRA", "EDDF", "Frankfurt", "Frankfurt", "DE", 50.03, 8.57],
  ["MUC", "EDDM", "Munich", "Munich", "DE", 48.35, 11.79],
  ["BER", "EDDB", "Brandenburg", "Berlin", "DE", 52.37, 13.50],
  ["HAM", "EDDH", "Hamburg", "Hamburg", "DE", 53.63, 9.99],
  ["ZRH", "LSZH", "Zürich", "Zurich", "CH", 47.46, 8.55],
  ["GVA", "LSGG", "Geneva", "Geneva", "CH", 46.24, 6.11],
  ["VIE", "LOWW", "Vienna", "Vienna", "AT", 48.11, 16.57],
  ["CPH", "EKCH", "Kastrup", "Copenhagen", "DK", 55.62, 12.66],
  ["ARN", "ESSA", "Arlanda", "Stockholm", "SE", 59.65, 17.92],
  ["OSL", "ENGM", "Gardermoen", "Oslo", "NO", 60.19, 11.10],
  ["HEL", "EFHK", "Helsinki-Vantaa", "Helsinki", "FI", 60.32, 24.96],
  ["KEF", "BIKF", "Keflavík", "Reykjavik", "IS", 63.99, -22.61],
  ["MAD", "LEMD", "Barajas", "Madrid", "ES", 40.47, -3.56],
  ["BCN", "LEBL", "El Prat", "Barcelona", "ES", 41.30, 2.08],
  ["PMI", "LEPA", "Palma", "Palma de Mallorca", "ES", 39.55, 2.74],
  ["LIS", "LPPT", "Humberto Delgado", "Lisbon", "PT", 38.78, -9.14],
  ["FCO", "LIRF", "Fiumicino", "Rome", "IT", 41.80, 12.25],
  ["MXP", "LIMC", "Malpensa", "Milan", "IT", 45.63, 8.72],
  ["VCE", "LIPZ", "Marco Polo", "Venice", "IT", 45.51, 12.35],
  ["NAP", "LIRN", "Capodichino", "Naples", "IT", 40.89, 14.29],
  ["CTA", "LICC", "Fontanarossa", "Catania", "IT", 37.47, 15.07],
  ["ATH", "LGAV", "Eleftherios Venizelos", "Athens", "GR", 37.94, 23.94],
  ["IST", "LTFM", "Istanbul", "Istanbul", "TR", 41.26, 28.74],
  ["SAW", "LTFJ", "Sabiha Gökçen", "Istanbul", "TR", 40.90, 29.31],
  ["WAW", "EPWA", "Chopin", "Warsaw", "PL", 52.17, 20.97],
  ["PRG", "LKPR", "Václav Havel", "Prague", "CZ", 50.10, 14.26],
  ["BUD", "LHBP", "Ferenc Liszt", "Budapest", "HU", 47.44, 19.26],
  ["OTP", "LROP", "Henri Coandă", "Bucharest", "RO", 44.57, 26.09],
  ["SVO", "UUEE", "Sheremetyevo", "Moscow", "RU", 55.97, 37.41],
  ["LED", "ULLI", "Pulkovo", "Saint Petersburg", "RU", 59.80, 30.26],
  // Middle East and Africa
  ["DXB", "OMDB", "Dubai", "Dubai", "AE", 25.25, 55.36],
  ["AUH", "OMAA", "Zayed", "Abu Dhabi", "AE", 24.43, 54.65],
  ["DOH", "OTHH", "Hamad", "Doha", "QA", 25.27, 51.61],
  ["RUH", "OERK", "King Khalid", "Riyadh", "SA", 24.96, 46.70],
  ["JED", "OEJN", "King Abdulaziz", "Jeddah", "SA", 21.68, 39.16],
  ["TLV", "LLBG", "Ben Gurion", "Tel Aviv", "IL", 32.01, 34.89],
  ["AMM", "OJAI", "Queen Alia", "Amman", "JO", 31.72, 35.99],
  ["MCT", "OOMS", "Muscat", "Muscat", "OM", 23.59, 58.28],
  ["IKA", "OIIE", "Imam Khomeini", "Tehran", "IR", 35.42, 51.15],
  ["CAI", "HECA", "Cairo", "Cairo", "EG", 30.12, 31.41],
  ["CMN", "GMMN", "Mohammed V", "Casablanca", "MA", 33.37, -7.59],
  ["RAK", "GMMX", "Menara", "Marrakesh", "MA", 31.61, -8.04],
  ["ALG", "DAAG", "Houari Boumediene", "Algiers", "DZ", 36.69, 3.22],
  ["TUN", "DTTA", "Carthage", "Tunis", "TN", 36.85, 10.23],
  ["ADD", "HAAB", "Bole", "Addis Ababa", "ET", 8.98, 38.80],
  ["NBO", "HKJK", "Jomo Kenyatta", "Nairobi", "KE", -1.32, 36.93],
  ["DAR", "HTDA", "Julius Nyerere", "Dar es Salaam", "TZ", -6.88, 39.20],
  ["EBB", "HUEN", "Entebbe", "Kampala", "UG", 0.04, 32.44],
  ["KGL", "HRYR", "Kigali", "Kigali", "RW", -1.97, 30.14],
  ["LOS", "DNMM", "Murtala Muhammed", "Lagos", "NG", 6.58, 3.32],
  ["ABV", "DNAA", "Nnamdi Azikiwe", "Abuja", "NG", 9.01, 7.26],
  ["ACC", "DGAA", "Kotoka", "Accra", "GH", 5.61, -0.17],
  ["DSS", "GOBD", "Blaise Diagne", "Dakar", "SN", 14.67, -17.07],
  ["ABJ", "DIAP", "Félix Houphouët-Boigny", "Abidjan", "CI", 5.26, -3.93],
  ["JNB", "FAOR", "O. R. Tambo", "Johannesburg", "ZA", -26.14, 28.24],
  ["CPT", "FACT", "Cape Town", "Cape Town", "ZA", -33.97, 18.60],
  ["DUR", "FALE", "King Shaka", "Durban", "ZA", -29.61, 31.12],
  ["MRU", "FIMP", "Sir Seewoosagur Ramgoolam", "Mauritius", "MU", -20.43, 57.68],
  ["TNR", "FMMI", "Ivato", "Antananarivo", "MG", -18.80, 47.48],
  ["LAD", "FNLU", "Quatro de Fevereiro", "Luanda", "AO", -8.86, 13.23],
  ["SEZ", "FSIA", "Seychelles", "Mahé", "SC", -4.67, 55.52],
  // Asia
  ["DEL", "VIDP", "Indira Gandhi", "Delhi", "IN", 28.56, 77.10],
  ["BOM", "VABB", "Chhatrapati Shivaji Maharaj", "Mumbai", "IN", 19.09, 72.87],
  ["BLR", "VOBL", "Kempegowda", "Bangalore", "IN", 13.20, 77.71],
  ["MAA", "VOMM", "Chennai", "Chennai", "IN", 12.99, 80.17],
  ["CCU", "VECC", "Netaji Subhas Chandra Bose", "Kolkata", "IN", 22.65, 88.45],
  ["HYD", "VOHS", "Rajiv Gandhi", "Hyderabad", "IN", 17.24, 78.43],
  ["COK", "VOCI", "Cochin", "Kochi", "IN", 10.15, 76.40],
  ["KHI", "OPKC", "Jinnah", "Karachi", "PK", 24.91, 67.16],
  ["ISB", "OPIS", "Islamabad", "Islamabad", "PK", 33.55, 72.83],
  ["DAC", "VGHS", "Hazrat Shahjalal", "Dhaka", "BD", 23.84, 90.40],
  ["CMB", "VCBI", "Bandaranaike", "Colombo", "LK", 7.18, 79.88],
  ["MLE", "VRMM", "Velana", "Malé", "MV", 4.19, 73.53],
  ["KTM", "VNKT", "Tribhuvan", "Kathmandu", "NP", 27.70, 85.36],
  ["BKK", "VTBS", "Suvarnabhumi", "Bangkok", "TH", 13.69, 100.75],
  ["DMK", "VTBD", "Don Mueang", "Bangkok", "TH", 13.91, 100.61],
  ["HKT", "VTSP", "Phuket", "Phuket", "TH", 8.11, 98.32],
  ["SIN", "WSSS", "Changi", "Singapore", "SG", 1.36, 103.99],
  ["KUL", "WMKK", "Kuala Lumpur", "Kuala Lumpur", "MY", 2.75, 101.71],
  ["CGK", "WIII", "Soekarno-Hatta", "Jakarta", "ID", -6.13, 106.66],
  ["DPS", "WADD", "Ngurah Rai", "Denpasar", "ID", -8.75, 115.17],
  ["MNL", "RPLL", "Ninoy Aquino", "Manila", "PH", 14.51, 121.02],
  ["CEB", "RPVM", "Mactan-Cebu", "Cebu", "PH", 10.31, 123.98],
  ["SGN", "VVTS", "Tan Son Nhat", "Ho Chi Minh City", "VN", 10.82, 106.65],
  ["HAN", "VVNB", "Noi Bai", "Hanoi", "VN", 21.22, 105.81],
  ["RGN", "VYYY", "Yangon", "Yangon", "MM", 16.91, 96.13],
  ["PNH", "VDPP", "Phnom Penh", "Phnom Penh", "KH", 11.55, 104.84],
  ["HKG", "VHHH", "Hong Kong", "Hong Kong", "HK", 22.31, 113.92],
  ["MFM", "VMMC", "Macau", "Macau", "MO", 22.15, 113.59],
  ["TPE", "RCTP", "Taoyuan", "Taipei", "TW", 25.08, 121.23],
  ["PEK", "ZBAA", "Capital", "Beijing", "CN", 40.08, 116.58],
  ["PKX", "ZBAD", "Daxing", "Beijing", "CN", 39.51, 116.41],
  ["PVG", "ZSPD", "Pudong", "Shanghai", "CN", 31.14, 121.81],
  ["SHA", "ZSSS", "Hongqiao", "Shanghai", "CN", 31.20, 121.34],
  ["CAN", "ZGGG", "Baiyun", "Guangzhou", "CN", 23.39, 113.30],
  ["SZX", "ZGSZ", "Bao'an", "Shenzhen", "CN", 22.64, 113.81],
  ["CTU", "ZUUU", "Shuangliu", "Chengdu", "CN", 30.58, 103.95],
  ["KMG", "ZPPP", "Changshui", "Kunming", "CN", 25.10, 102.93],
  ["XIY", "ZLXY", "Xianyang", "Xi'an", "CN", 34.45, 108.75],
  ["URC", "ZWWW", "Diwopu", "Ürümqi", "CN", 43.91, 87.47],
  ["ICN", "RKSI", "Incheon", "Seoul", "KR", 37.46, 126.44],
  ["GMP", "RKSS", "Gimpo", "Seoul", "KR", 37.56, 126.79],
  ["PUS", "RKPK", "Gimhae", "Busan", "KR", 35.18, 128.94],
  ["NRT", "RJAA", "Narita", "Tokyo", "JP", 35.77, 140.39],
  ["HND", "RJTT", "Haneda", "Tokyo", "JP", 35.55, 139.78],
  ["KIX", "RJBB", "Kansai", "Osaka", "JP", 34.43, 135.24],
  ["NGO", "RJGG", "Chubu Centrair", "Nagoya", "JP", 34.86, 136.81],
  ["FUK", "RJFF", "Fukuoka", "Fukuoka", "JP", 33.59, 130.45],
  ["CTS", "RJCC", "New Chitose", "Sapporo", "JP", 42.78, 141.69],
  ["OKA", "ROAH", "Naha", "Okinawa", "JP", 26.21, 127.65],
  ["ULN", "ZMCK", "Chinggis Khaan", "Ulaanbaatar", "MN", 47.65, 106.82],
  ["ALA", "UAAA", "Almaty", "Almaty", "KZ", 43.35, 77.04],
  ["TAS", "UTTT", "Tashkent", "Tashkent", "UZ", 41.26, 69.28],
  ["VVO", "UHWW", "Vladivostok", "Vladivostok", "RU", 43.40, 132.15],
  // Oceania
  ["SYD", "YSSY", "Kingsford Smith", "Sydney", "AU", -33.95, 151.18],
  ["MEL", "YMML", "Tullamarine", "Melbourne", "AU", -37.67, 144.84],
  ["BNE", "YBBN", "Brisbane", "Brisbane", "AU", -27.38, 153.12],
  ["PER", "YPPH", "Perth", "Perth", "AU", -31.94, 115.97],
  ["ADL", "YPAD", "Adelaide", "Adelaide", "AU", -34.95, 138.53],
  ["CNS", "YBCS", "Cairns", "Cairns", "AU", -16.88, 145.75],
  ["DRW", "YPDN", "Darwin", "Darwin", "AU", -12.41, 130.88],
  ["AKL", "NZAA", "Auckland", "Auckland", "NZ", -37.01, 174.79],
  ["WLG", "NZWN", "Wellington", "Wellington", "NZ", -41.33, 174.81],
  ["CHC", "NZCH", "Christchurch", "Christchurch", "NZ", -43.49, 172.53],
  ["NAN", "NFFN", "Nadi", "Nadi", "FJ", -17.76, 177.44],
  ["PPT", "NTAA", "Faa'a", "Papeete", "PF", -17.56, -149.61],
  ["NOU", "NWWW", "La Tontouta", "Nouméa", "NC", -22.01, 166.21],
  ["POM", "AYPY", "Jacksons", "Port Moresby", "PG", -9.44, 147.22],
  ["GUM", "PGUM", "Won Pat", "Guam", "GU", 13.48, 144.80],
  // North America
  ["JFK", "KJFK", "John F. Kennedy", "New York", "US", 40.64, -73.78],
  ["EWR", "KEWR", "Newark Liberty", "Newark", "US", 40.69, -74.17],
  ["LGA", "KLGA", "LaGuardia", "New York", "US", 40.78, -73.87],
  ["BOS", "KBOS", "Logan", "Boston", "US", 42.36, -71.01],
  ["PHL", "KPHL", "Philadelphia", "Philadelphia", "US", 39.87, -75.24],
  ["IAD", "KIAD", "Dulles", "Washington", "US", 38.95, -77.46],
  ["DCA", "KDCA", "Reagan National", "Washington", "US", 38.85, -77.04],
  ["ATL", "KATL", "Hartsfield-Jackson", "Atlanta", "US", 33.64, -84.43],
  ["CLT", "KCLT", "Charlotte Douglas", "Charlotte", "US", 35.21, -80.94],
  ["MCO", "KMCO", "Orlando", "Orlando", "US", 28.43, -81.31],
  ["MIA", "KMIA", "Miami", "Miami", "US", 25.79, -80.29],
  ["FLL", "KFLL", "Fort Lauderdale-Hollywood", "Fort Lauderdale", "US", 26.07, -80.15],
  ["TPA", "KTPA", "Tampa", "Tampa", "US", 27.98, -82.53],
  ["ORD", "KORD", "O'Hare", "Chicago", "US", 41.98, -87.90],
  ["DTW", "KDTW", "Detroit Metropolitan", "Detroit", "US", 42.21, -83.35],
  ["MSP", "KMSP", "Minneapolis–Saint Paul", "Minneapolis", "US", 44.88, -93.22],
  ["DFW", "KDFW", "Dallas/Fort Worth", "Dallas", "US", 32.90, -97.04],
  ["IAH", "KIAH", "George Bush Intercontinental", "Houston", "US", 29.98, -95.34],
  ["MSY", "KMSY", "Louis Armstrong", "New Orleans", "US", 29.99, -90.26],
  ["DEN", "KDEN", "Denver", "Denver", "US", 39.86, -104.67],
  ["PHX", "KPHX", "Sky Harbor", "Phoenix", "US", 33.43, -112.01],
  ["LAS", "KLAS", "Harry Reid", "Las Vegas", "US", 36.08, -115.15],
  ["LAX", "KLAX", "Los Angeles", "Los Angeles", "US", 33.94, -118.41],
  ["SAN", "KSAN", "San Diego", "San Diego", "US", 32.73, -117.19],
  ["SFO", "KSFO", "San Francisco", "San Francisco", "US", 37.62, -122.38],
  ["SEA", "KSEA", "Seattle–Tacoma", "Seattle", "US", 47.45, -122.31],
  ["PDX", "KPDX", "Portland", "Portland", "US", 45.59, -122.60],
  ["SLC", "KSLC", "Salt Lake City", "Salt Lake City", "US", 40.79, -111.98],
  ["ANC", "PANC", "Ted Stevens", "Anchorage", "US", 61.17, -149.99],
  ["HNL", "PHNL", "Daniel K. Inouye", "Honolulu", "US", 21.32, -157.92],
  ["YYZ", "CYYZ", "Pearson", "Toronto", "CA", 43.68, -79.63],
  ["YUL", "CYUL", "Trudeau", "Montreal", "CA", 45.47, -73.74],
  ["YVR", "CYVR", "Vancouver", "Vancouver", "CA", 49.19, -123.18],
  ["YYC", "CYYC", "Calgary", "Calgary", "CA", 51.13, -114.01],
  ["YHZ", "CYHZ", "Stanfield", "Halifax", "CA", 44.88, -63.51],
  ["MEX", "MMMX", "Benito Juárez", "Mexico City", "MX", 19.44, -99.07],
  ["CUN", "MMUN", "Cancún", "Cancun", "MX", 21.04, -86.87],
  ["GDL", "MMGL", "Guadalajara", "Guadalajara", "MX", 20.52, -103.31],
  ["MTY", "MMMY", "Monterrey", "Monterrey", "MX", 25.78, -100.11],
  // Central America and the Caribbean
  ["PTY", "MPTO", "Tocumen", "Panama City", "PA", 9.07, -79.38],
  ["SJO", "MROC", "Juan Santamaría", "San José", "CR", 9.99, -84.21],
  ["GUA", "MGGT", "La Aurora", "Guatemala City", "GT", 14.58, -90.53],
  ["SAL", "MSLP", "Monseñor Romero", "San Salvador", "SV", 13.44, -89.06],
  ["HAV", "MUHA", "José Martí", "Havana", "CU", 22.99, -82.41],
  ["SJU", "TJSJ", "Luis Muñoz Marín", "San Juan", "PR", 18.44, -66.00],
  ["SDQ", "MDSD", "Las Américas", "Santo Domingo", "DO", 18.43, -69.67],
  ["PUJ", "MDPC", "Punta Cana", "Punta Cana", "DO", 18.57, -68.36],
  ["MBJ", "MKJS", "Sangster", "Montego Bay", "JM", 18.50, -77.91],
  ["KIN", "MKJP", "Norman Manley", "Kingston", "JM", 17.94, -76.79],
  ["NAS", "MYNN", "Lynden Pindling", "Nassau", "BS", 25.04, -77.47],
  ["BGI", "TBPB", "Grantley Adams", "Bridgetown", "BB", 13.07, -59.49],
  ["POS", "TTPP", "Piarco", "Port of Spain", "TT", 10.60, -61.34],
  ["PTP", "TFFR", "Pointe-à-Pitre", "Guadeloupe", "GP", 16.27, -61.53],
  ["CUR", "TNCC", "Hato", "Curaçao", "CW", 12.19, -68.96],
  // South America
  ["BOG", "SKBO", "El Dorado", "Bogotá", "CO", 4.70, -74.15],
  ["MDE", "SKRG", "José María Córdova", "Medellín", "CO", 6.16, -75.42],
  ["CCS", "SVMI", "Simón Bolívar", "Caracas", "VE", 10.60, -66.99],
  ["UIO", "SEQM", "Mariscal Sucre", "Quito", "EC", -0.13, -78.36],
  ["GYE", "SEGU", "José Joaquín de Olmedo", "Guayaquil", "EC", -2.16, -79.88],
  ["LIM", "SPJC", "Jorge Chávez", "Lima", "PE", -12.02, -77.11],
  ["CUZ", "SPZO", "Velasco Astete", "Cusco", "PE", -13.54, -71.94],
  ["LPB", "SLLP", "El Alto", "La Paz", "BO", -16.51, -68.19],
  ["SCL", "SCEL", "Arturo Merino Benítez", "Santiago", "CL", -33.39, -70.79],
  ["EZE", "SAEZ", "Ministro Pistarini", "Buenos Aires", "AR", -34.82, -58.54],
  ["AEP", "SABE", "Jorge Newbery", "Buenos Aires", "AR", -34.56, -58.42],
  ["MVD", "SUMU", "Carrasco", "Montevideo", "UY", -34.84, -56.03],
  ["ASU", "SGAS", "Silvio Pettirossi", "Asunción", "PY", -25.24, -57.52],
  ["GRU", "SBGR", "Guarulhos", "São Paulo", "BR", -23.44, -46.47],
  ["GIG", "SBGL", "Galeão", "Rio de Janeiro", "BR", -22.81, -43.25],
  ["BSB", "SBBR", "Brasília", "Brasília", "BR", -15.87, -47.92],
  ["SSA", "SBSV", "Salvador", "Salvador", "BR", -12.91, -38.33],
  ["REC", "SBRF", "Guararapes", "Recife", "BR", -8.13, -34.92],
  ["FOR", "SBFZ", "Pinto Martins", "Fortaleza", "BR", -3.78, -38.53],
  ["MAO", "SBEG", "Eduardo Gomes", "Manaus", "BR", -3.04, -60.05],
  ["POA", "SBPA", "Salgado Filho", "Porto Alegre", "BR", -29.99, -51.17],
];

export const AIRPORTS = ROWS.map(([iata, icao, name, city, country, lat, lon]) => ({ iata, icao, name, city, country, lat, lon }));

const key = (s) => String(s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/\b(airport|international|intl|aeroporto|aeropuerto|aeroport)\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

/** What each airport answers to: its codes, its city, its name, "city name". */
function names(a) {
  return [a.iata, a.icao, a.city, a.name, `${a.city} ${a.name}`].map(key).filter(Boolean);
}

/**
 * The airport a phrase names: an IATA or ICAO code, a city (its first airport
 * in the table, which lists each city's main airport first), an airport's own
 * name, or the closest spelling within a quarter of the phrase's length.
 * Returns { airport, how } or null — never a guess past that.
 */
export function findAirport(phrase, list = AIRPORTS) {
  const raw = String(phrase || "").trim();
  if (!raw) return null;
  const code = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) {
    const a = list.find((x) => x.iata === code);
    if (a) return { airport: a, how: "iata" };
  }
  if (/^[A-Z]{4}$/.test(code)) {
    const a = list.find((x) => x.icao === code);
    if (a) return { airport: a, how: "icao" };
  }
  const k = key(raw);
  if (!k) return null;
  const exact = list.find((a) => names(a).includes(k));
  if (exact) return { airport: exact, how: "name" };
  const word = list.find((a) => names(a).some((n) => ` ${k} `.includes(` ${n} `) && n.length >= 4));
  if (word) return { airport: word, how: "word" };
  let best = null; let bestD = Infinity;
  for (const a of list) {
    for (const n of names(a)) {
      const d = editDistance(n, k);
      if (d < bestD) { bestD = d; best = a; }
    }
  }
  if (best && k.length >= 4 && bestD <= Math.max(1, Math.floor(k.length / 4))) return { airport: best, how: "close", distance: bestD };
  return null;
}

export function airportLabel(a) {
  return a ? `${a.city} ${a.iata}` : "";
}
