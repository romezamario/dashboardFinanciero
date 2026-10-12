// Reglas de categorización con las que llegan los movimientos de un cliente
// (Ordena tu Lana). Se armaron a partir de las reglas de la app de escritorio
// del dueño, dejando solo cadenas, servicios y términos bancarios que le
// sirven a cualquiera: sin negocios locales, viajes, médicos, empleadores ni
// números de tarjeta (este repo es público). Mismo funcionamiento que
// transform/categorizador.py: si el patrón aparece en la descripción (sin
// importar mayúsculas) se asignan su categoría y comercio, y la PRIMERA regla
// que coincide gana — por eso lo específico va antes que lo genérico
// ("OXXO GAS" antes que "OXXO", "UBER EATS" antes que "UBER"); la prueba
// reglasBase.test.ts falla si una regla queda tapada por otra anterior.

export interface Regla {
  patron: string;
  categoria: string;
  comercio: string | null;
}

const r = (patron: string, categoria: string, comercio: string | null): Regla => ({ patron, categoria, comercio });

export const REGLAS_BASE: readonly Regla[] = [
  // Pagos a la tarjeta y movimientos entre cuentas (se ocultan por defecto
  // en el tablero: si no, pagar la tarjeta contaría como gasto e ingreso).
  r("PAGO TDC", "Pago TDC", "Pago TDC"),
  r("SU PAGO GRACIAS", "Pago TDC", "Pago TDC"),
  r("SU PAGO POR SPEI", "Pago TDC", "Pago TDC"),
  r("SU ABONO", "Pago TDC", "Pago TDC"),
  r("PAGO RECIBIDO", "Transferencia recibida", "Transferencia recibida"),
  r("SU PAGO INTERBANCARIO", "Transferencia recibida", "Transferencia recibida"),
  r("PAGO INTERBANCARIO", "Transferencia enviada", "Transferencia enviada"),

  // Efectivo, comisiones e intereses.
  r(" ATM ", "Disposición de efectivo", "Disposición de efectivo"),
  r("DIS.EFE.", "Disposición de efectivo", "Disposición de efectivo"),
  r("DIS.S.T.BANAMEX", "Disposición de efectivo", "Disposición de efectivo"),
  r("DISP EFVO", "Disposición de efectivo", "Disposición de efectivo"),
  r("DISPOSICION EFECTIVO", "Disposición de efectivo", "Disposición de efectivo"),
  r("BON IVA ADMIN", "Comisiones bancarias", "Comisiones bancarias"),
  r("BONIF COM ADMON CRED", "Comisiones bancarias", "Comisiones bancarias"),
  r("IVA OTROS CARGOS", "Comisiones bancarias", "Comisiones bancarias"),
  r("PROMO ANUAL ADIC", "Comisiones bancarias", "Comisiones bancarias"),
  r("COMISION", "Comisiones bancarias", "Comisiones bancarias"),
  r("INTERES", "Intereses", "Intereses"),
  r("CREDITO NOMINA", "Crédito personal", "Crédito personal"),
  r("NOMINA", "Nómina", "Nómina"),

  // Suscripciones y servicios domiciliados.
  r("AMAZONPRIMESUBS", "Domiciliación", "Amazon Prime"),
  r("APPLE.COM/BILL", "Domiciliación", "Apple"),
  r("NETFLIX", "Domiciliación", "Netflix"),
  r("SPOTIFY", "Domiciliación", "Spotify"),
  r("DISNEY PLUS", "Domiciliación", "Disney+"),
  r("DISNEYPLUS", "Domiciliación", "Disney+"),
  r("CHATGPT", "Domiciliación", "ChatGPT"),
  r("ANTHROPIC", "Domiciliación", "Claude"),
  r("EBANX CANVA", "Domiciliación", "Canva"),
  r("CANVA", "Domiciliación", "Canva"),
  r("DOMESTIKA", "Domiciliación", "Domestika"),
  r("ZOOM.US", "Domiciliación", "Zoom"),
  r("ZOOM.COM", "Domiciliación", "Zoom"),
  r("IZZI", "Domiciliación", "Izzi"),
  r("TOTALPLAY", "Domiciliación", "Totalplay"),
  r("MEGACABLE", "Domiciliación", "Megacable"),
  r("TELMEX", "Domiciliación", "Telmex"),
  r("TELCEL", "Domiciliación", "Telcel"),
  r("PLANET FITNESS", "Domiciliación", "Gimnasio"),
  r("SMART FIT", "Domiciliación", "Gimnasio"),
  r("TOTAL PASS", "Domiciliación", "Total Pass"),

  // Servicios de la casa e impuestos.
  r("CIA MEXICANA DE G", "Pago de servicios", "Gas"),
  r("PAGO DE IMPUESTOS", "Pago de servicios", "SAT"),
  r("PAGO DE SERVICIO", "Pago de servicios", "Pago de servicios"),
  r("CFE", "Pago de servicios", "CFE"),

  // Supermercado y tiendas de conveniencia (las gasolineras de Oxxo y
  // Costco van antes: son Transporte).
  r("OXXO GAS", "Transporte", "Gasolinera"),
  r("COSTCO GAS", "Transporte", "Gasolinera"),
  r("OXXO", "Supermercado", "Oxxo"),
  r("7 ELEVEN", "Supermercado", "7-Eleven"),
  r("7-ELEVEN", "Supermercado", "7-Eleven"),
  r("CIRCLEK", "Supermercado", "Circle K"),
  r("CIRCLE K", "Supermercado", "Circle K"),
  r("UBER *CORNERSHOP", "Supermercado", "Cornershop"),
  r("WALMART", "Supermercado", "Walmart"),
  r("WAL-MART", "Supermercado", "Walmart"),
  r("WM EXPRESS", "Supermercado", "Walmart"),
  r("SUPERCENTER", "Supermercado", "Walmart"),
  r("CASHI ECOMMERCE", "Supermercado", "Walmart"),
  r("BODEGA AURRERA", "Supermercado", "Bodega Aurrera"),
  r("SAMS VENTA EN LINEA", "Supermercado", "Sam's Club"),
  r("SAMS CLUB", "Supermercado", "Sam's Club"),
  r("COSTCO", "Supermercado", "Costco"),
  r("CITY CLUB", "Supermercado", "City Club"),
  r("SORIANA", "Supermercado", "Soriana"),
  r("CHEDRAUI", "Supermercado", "Chedraui"),
  r("LA COMER", "Supermercado", "La Comer"),
  r("CITY MARKET", "Supermercado", "City Market"),
  r("FRESH MARKET", "Supermercado", "Fresh Market"),
  r("AL SUPER", "Supermercado", "Al Super"),
  r("H-E-B", "Supermercado", "HEB"),
  r("H E B", "Supermercado", "HEB"),
  r("HEB", "Supermercado", "HEB"),

  // Restaurantes y entrega de comida (Uber Eats antes que Uber).
  r("UBER EATS", "Restaurantes", "Uber Eats"),
  r("RAPPI", "Restaurantes", "Rappi"),
  r("DIDI FOOD", "Restaurantes", "DiDi Food"),
  r("STARBUCKS", "Restaurantes", "Starbucks"),
  r("SBX", "Restaurantes", "Starbucks"),
  r("MCDONALD", "Restaurantes", "McDonald's"),
  r("MC DONALD S", "Restaurantes", "McDonald's"),
  r("BURGER KING", "Restaurantes", "Burger King"),
  r("CARLS JR", "Restaurantes", "Carl's Jr"),
  r("KFC", "Restaurantes", "KFC"),
  r("POPEYES", "Restaurantes", "Popeyes"),
  r("DOMINOS", "Restaurantes", "Domino's Pizza"),
  r("PIZZA HUT", "Restaurantes", "Pizza Hut"),
  r("LITTLE CAESARS", "Restaurantes", "Little Caesars"),
  r("SUBWAY", "Restaurantes", "Subway"),
  r("DAIRY QUEEN", "Restaurantes", "Dairy Queen"),
  r("KRISPY KREME", "Restaurantes", "Krispy Kreme"),
  r("AUNTIE ANNE", "Restaurantes", "Auntie Anne's"),
  r("PANDA EXPRES", "Restaurantes", "Panda Express"),
  r("FIVE GUYS", "Restaurantes", "Five Guys"),
  r("SHAKE SHACK", "Restaurantes", "Shake Shack"),
  r("WHATABURGER", "Restaurantes", "Whataburger"),
  r("CHICK-FIL-A", "Restaurantes", "Chick-fil-A"),
  r("CHILI'S", "Restaurantes", "Chili's"),
  r("CHILIS", "Restaurantes", "Chili's"),
  r("TEXAS ROADHOUSE", "Restaurantes", "Texas Roadhouse"),
  r("CRACKER BARREL", "Restaurantes", "Cracker Barrel"),
  r("IHOP", "Restaurantes", "IHOP"),
  r("DENNY'S", "Restaurantes", "Denny's"),
  r("DENNYS", "Restaurantes", "Denny's"),
  r("DENNY S #", "Restaurantes", "Denny's"),
  r("BOSTONS", "Restaurantes", "Boston's"),
  r("ITALIANNIS", "Restaurantes", "Italianni's"),
  r("SUSHI ITTO", "Restaurantes", "Sushi Itto"),
  r("SUSHIITTO", "Restaurantes", "Sushi Itto"),
  r("SANBORNS", "Restaurantes", "Sanborns"),
  r("SANBORN S", "Restaurantes", "Sanborns"),
  r("REST VIP S", "Restaurantes", "Vips"),
  r("VIPS", "Restaurantes", "Vips"),
  r("TOKS", "Restaurantes", "Toks"),
  r("EL BAJIO", "Restaurantes", "El Bajío"),
  r("CREPES & WAFFLES", "Restaurantes", "Crepes & Waffles"),
  r("EL GLOBO", "Restaurantes", "El Globo"),
  r("LE PAIN QUOTIDIEN", "Restaurantes", "Le Pain Quotidien"),
  r("MAISON KAYSER", "Restaurantes", "Maison Kayser"),

  // Transporte.
  r("TELEVIA", "Transporte", "Televia"),
  r("DIDI", "Transporte", "DiDi"),
  r("UBER", "Transporte", "Uber"),
  r("PEMEX", "Transporte", "Gasolinera"),
  r("PETRO7", "Transporte", "Gasolinera"),
  r("G500", "Transporte", "Gasolinera"),
  r("GASOL", "Transporte", "Gasolinera"),
  r("HERTZ", "Transporte", "Hertz"),
  r("SIXT", "Transporte", "Sixt"),
  r("PARKIT", "Transporte", "Estacionamiento"),
  r("KIGO", "Transporte", "Kigo"),
  r("LIME*", "Transporte", "Lime"),

  // Vuelos y hospedaje.
  r("AEROMEXICO", "Vuelos", "Aeromexico"),
  r("AEROMEX WEB MX", "Vuelos", "Aeromexico"),
  r("VIVA AEROBUS", "Vuelos", "Viva Aerobus"),
  r("VIVAAEROBUS", "Vuelos", "Viva Aerobus"),
  r("VOLARIS", "Vuelos", "Volaris"),
  r("AIRBNB", "Hospedaje", "Airbnb"),
  r("BOOKING.COM", "Hospedaje", "Booking.com"),
  r("HOTELES COM", "Hospedaje", "Hoteles.com"),
  r("HOLIDAY INN", "Hospedaje", "Holiday Inn"),
  r("BEST WESTERN", "Hospedaje", "Best Western"),

  // Salud.
  r("BENAVIDES", "Salud", "Farmacias Benavides"),
  r("FARM GUADALAJARA", "Salud", "Farmacia Guadalajara"),
  r("FARMACIAS DEL AHORRO", "Salud", "Farmacias del Ahorro"),
  r("FARMACIAS SIMILARES", "Salud", "Farmacias Similares"),
  r("FARM SAN PABLO", "Salud", "Farmacia San Pablo"),
  r("FSANPABLO", "Salud", "Farmacia San Pablo"),
  r("HOSP ANGELES", "Salud", "Hospital Ángeles"),

  // Ocio.
  r("TICKETMASTER", "Ocio", "Ticketmaster"),
  r("OCESA", "Ocio", "Ocesa"),
  r("CINEPOLIS", "Ocio", "Cinépolis"),
  r("CINEMEX", "Ocio", "Cinemex"),
  r("FUNTICKET", "Ocio", "Funticket"),
  r("BOLETOMOVIL", "Ocio", "Boletomovil"),
  r("LOTERIA", "Ocio", "Lotería Nacional"),
  r("TOPGOLF", "Ocio", "TopGolf"),

  // Compras.
  r("MERPAGO*MERCADOLIBRE", "Compras", "Mercado Libre"),
  r("MERCADOLIBRE", "Compras", "Mercado Libre"),
  r("AMAZON", "Compras", "Amazon"),
  r("TEMU", "Compras", "Temu"),
  r("SHEIN", "Compras", "Shein"),
  r("LIVERPOOL", "Compras", "Liverpool"),
  r("PALACIO HIERRO", "Compras", "Palacio de Hierro"),
  r("PALACIOHIERRO", "Compras", "Palacio de Hierro"),
  r("SUBURBIA", "Compras", "Suburbia"),
  r("COPPEL", "Compras", "Coppel"),
  r("SEARS", "Compras", "Sears"),
  r("HOME DEPOT", "Compras", "Home Depot"),
  r("SODIMAC", "Compras", "Sodimac"),
  r("OFFICE DEPOT", "Compras", "Office Depot"),
  r("OFFICE MAX", "Compras", "Office Max"),
  r("OFFICEMAX", "Compras", "Office Max"),
  r("AUTOZONE", "Compras", "AutoZone"),
  r("APPLE ONLINE STORE", "Compras", "Apple"),
  r("ISHOP MIXUP", "Compras", "iShop"),
  r("XIAOMI", "Compras", "Xiaomi"),
  r("GANDHI", "Compras", "Gandhi"),
  r("SEPHORA", "Compras", "Sephora"),
  r("BATH AND BODY WORKS", "Compras", "Bath & Body Works"),
  r("VICTORIA'S SECRET", "Compras", "Victoria's Secret"),
  r("VICTORIA S SECRET", "Compras", "Victoria's Secret"),
  r("MINISO", "Compras", "Miniso"),
  r("MUMUSO", "Compras", "Mumuso"),
  r("TODOMODA", "Compras", "Todomoda"),
  r("CASA IDEAS", "Compras", "Casa Ideas"),
  r("ZARA", "Compras", "Zara"),
  r("BERSHKA", "Compras", "Bershka"),
  r("PULL&BEAR", "Compras", "Pull&Bear"),
  r("STRADIVARIUS", "Compras", "Stradivarius"),
  r("OYSHO", "Compras", "Oysho"),
  r("LEFTIES", "Compras", "Lefties"),
  r("H&M MX", "Compras", "H&M"),
  r("HM MX", "Compras", "H&M"),
  r("UNIQLO", "Compras", "Uniqlo"),
  r("FOREVER21", "Compras", "Forever 21"),
  r("AEROPOSTALE", "Compras", "Aeropostale"),
  r("AMERICAN EAGLE", "Compras", "American Eagle"),
  r("OLD NAVY", "Compras", "Old Navy"),
  r("STEVE MADDEN", "Compras", "Steve Madden"),
  r("CALZEDONIA", "Compras", "Calzedonia"),
  r("INTIMISSIMI", "Compras", "Intimissimi"),
  r("LULULEMON", "Compras", "Lululemon"),
  r("THE NORTH FACE", "Compras", "The North Face"),
  r("FOOT LOCKER", "Compras", "Foot Locker"),
  r("CROCS", "Compras", "Crocs"),
  r("DECATHLON", "Compras", "Decathlon"),
  r("DISNEY STORE", "Compras", "Disney Store"),
  r("ENVIAFLORES", "Compras", "EnviaFlores"),
  r("TARGET", "Compras", "Target"),
  r("ROSS STORES", "Compras", "Ross"),
  r("T J MAXX", "Compras", "TJ Maxx"),
  r("TJ MAXX", "Compras", "TJ Maxx"),
  r("MARSHALLS", "Compras", "Marshalls"),
  r("BURLINGTON STORES", "Compras", "Burlington"),
  r("HOMEGOODS", "Compras", "HomeGoods"),
  r("MACYS", "Compras", "Macy's"),

  // Paquetería, seguros y otros gastos.
  r("ESTAFETA", "Gastos", "Estafeta"),
  r("UNITED PARCEL SERVICE", "Gastos", "UPS"),
  r("FEDEX", "Gastos", "FedEx"),
  r("QUALITAS", "Gastos", "Qualitas"),
  r("FACEBK", "Gastos", "Facebook"),
  r("*NAYAX", "Gastos", "Máquina expendedora"),

  // Inversión.
  r("GBM", "Inversión", "GBM"),

  // Genéricos al final: solo si nada más específico coincidió.
  r("SPEI", "Transferencia", "Transferencia"),
  r("PAGO A", "Pago a persona", "Pago a persona"),
  r("DOMI", "Domiciliación", null),
];

/** (categoría, comercio) de la primera regla cuyo patrón aparece en la
 * descripción, o null si ninguna aplica. */
export function categorizar(descripcion: string, reglas: readonly Regla[] = REGLAS_BASE): Regla | null {
  const texto = descripcion.toUpperCase();
  return reglas.find((regla) => texto.includes(regla.patron.toUpperCase())) ?? null;
}
