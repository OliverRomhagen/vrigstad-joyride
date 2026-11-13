// Approximate NOAA solar position for Vrigstad; azimuth clockwise from north.
// World axes are X east, Z south, Y up; solar angles use radians.
export const VRIGSTAD = { latitude: 57.3555, longitude: 14.4756 };
export const DEFAULT_SOLAR_DATE = "2026-08-15";
export function validSolarDate(value: unknown) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
		return DEFAULT_SOLAR_DATE;
	const [year, month, day] = value.split("-").map(Number);
	const d = new Date(Date.UTC(year, month - 1, day));
	return d.getUTCFullYear() === year &&
		d.getUTCMonth() === month - 1 &&
		d.getUTCDate() === day
		? value
		: DEFAULT_SOLAR_DATE;
}
function euDst(year: number, month: number, day: number, hour: number) {
	if (month < 3 || month > 10) return false;
	if (month > 3 && month < 10) return true;
	const last = new Date(Date.UTC(year, month, 0));
	const lastSunday = last.getUTCDate() - last.getUTCDay();
	return month === 3
		? day > lastSunday || (day === lastSunday && hour >= 3)
		: day < lastSunday || (day === lastSunday && hour < 3);
}
export function solarPosition(
	hour: number,
	date = DEFAULT_SOLAR_DATE,
	utcOffset: number | null = null,
) {
	const valid = validSolarDate(date),
		[year, month, day] = valid.split("-").map(Number);
	const dateUTC = Date.UTC(year, month - 1, day);
	const n = Math.floor((dateUTC - Date.UTC(year, 0, 1)) / 86400000) + 1;
	const timezone =
		utcOffset === null ? (euDst(year, month, day, hour) ? 2 : 1) : utcOffset;
	const gamma = ((2 * Math.PI) / 365) * (n - 1 + (hour - 12) / 24);
	const eot =
		229.18 *
		(0.000075 +
			0.001868 * Math.cos(gamma) -
			0.032077 * Math.sin(gamma) -
			0.014615 * Math.cos(2 * gamma) -
			0.040849 * Math.sin(2 * gamma));
	const decl =
		0.006918 -
		0.399912 * Math.cos(gamma) +
		0.070257 * Math.sin(gamma) -
		0.006758 * Math.cos(2 * gamma) +
		0.000907 * Math.sin(2 * gamma) -
		0.002697 * Math.cos(3 * gamma) +
		0.00148 * Math.sin(3 * gamma);
	const hourAngle =
		(((hour * 60 + eot + 4 * VRIGSTAD.longitude - 60 * timezone) / 4) *
			Math.PI) /
			180 -
		Math.PI;
	const lat = (VRIGSTAD.latitude * Math.PI) / 180;
	const sine =
		Math.sin(lat) * Math.sin(decl) +
		Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
	const altitude = Math.asin(Math.max(-1, Math.min(1, sine)));
	const azimuth =
		(Math.atan2(
			Math.sin(hourAngle),
			Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat),
		) +
			3 * Math.PI) %
		(2 * Math.PI);
	return {
		altitude,
		azimuth,
		dx: Math.sin(azimuth) * Math.cos(altitude),
		dy: Math.sin(altitude),
		dz: -Math.cos(azimuth) * Math.cos(altitude),
		date: valid,
	};
}

// Seeded, smooth multi-day weather. No gameplay RNG and no per-frame state resets.
function weatherNoise(n: number) {
	const x = Math.sin(n * 127.1 + 82.37) * 43758.5453123;
	return x - Math.floor(x);
}
function weatherSmooth(x: number) {
	const i = Math.floor(x),
		f = x - i,
		t = f * f * (3 - 2 * f);
	return weatherNoise(i) * (1 - t) + weatherNoise(i + 1) * t;
}
export function weatherCoverage(
	hour: number,
	date = DEFAULT_SOLAR_DATE,
	utcOffset: number | null = null,
) {
	const valid = validSolarDate(date),
		day = Date.parse(valid + "T00:00:00Z") / 86400000;
	const [year, month, dateDay] = valid.split("-").map(Number);
	const t =
		day +
		(hour -
			(utcOffset === null
				? euDst(year, month, dateDay, hour)
					? 2
					: 1
				: utcOffset)) /
			24;
	// Multi-day front and intra-day fluctuations; no abrupt midnight transition.
	return Math.max(
		0.04,
		Math.min(
			0.94,
			0.08 +
				0.6 * weatherSmooth(t * 0.42 + 11) +
				0.3 * weatherSmooth(t * 2.1 + 73),
		),
	);
}
export function nextSolarDate(date: string) {
	const d = new Date(
		Date.parse(validSolarDate(date) + "T00:00:00Z") + 86400000,
	);
	return d.toISOString().slice(0, 10);
}

// Solar direction is geographic; exposure, clouds and tint are artistic.
export function daylightState(
	hour: number,
	cloudTime = 0,
	coverage: number | null = null,
	date = DEFAULT_SOLAR_DATE,
	utcOffset: number | null = null,
) {
	const h = ((hour % 24) + 24) % 24;
	const solar = solarPosition(h, date, utcOffset);
	const altitude = solar.altitude;
	const elevation = (altitude * 180) / Math.PI;
	const daytime = Math.max(0, Math.min(1, (elevation + 1.2) / 16));
	const warm = Math.max(0, Math.min(1, (35 - elevation) / 29));
	const cover =
		coverage === null
			? weatherCoverage(h, date, utcOffset)
			: Math.max(0, Math.min(1, coverage));
	// Broad cloud shadows: coherent across the entire scene; not a weather model.
	// Cloud cover also attenuates direct sun and glare, not just sky colour.
	const shade = Math.max(0.3, 1 - cover * 0.82);
	// Twilight keeps residual skylight after direct sun fades; actual night
	// still requires headlights and street lamps, not artificial daylight.
	const twilight = Math.max(0, Math.min(1, (elevation + 9) / 12));
	return {
		hour: h,
		date: solar.date,
		altitude,
		azimuth: solar.azimuth,
		daytime,
		warm,
		cover,
		shade,
		dx: solar.dx,
		dy: solar.dy,
		dz: solar.dz,
		strength: daytime * (1.44 - 0.48 * warm) * shade,
		exposure: 0.69 + 0.3 * daytime - 0.11 * warm + 0.03 * (1 - shade),
		skyBrightness: Math.max(0.15, (0.25 + 0.75 * daytime) * (1 - 0.27 * warm)),
		twilight,
	};
}
// One absolute simulation clock shared with future seasons/events (#114).
// Input is Stockholm civil time. A repeated autumn hour chooses the first
// occurrence; a nonexistent spring hour normalizes forward. Advancing thereafter
// uses UTC instants, so solar direction is continuous through DST transitions.
export function createSolarClock(date = DEFAULT_SOLAR_DATE, hour = 15.5) {
	const utc = new Date(0),
		local = new Date(0);
	let instant = 0,
		offset = 1,
		currentDate = "",
		currentHour = 0,
		cacheYear = 0,
		start = 0,
		end = 0;
	function sync() {
		utc.setTime(instant);
		const year = utc.getUTCFullYear();
		if (year !== cacheYear) {
			cacheYear = year;
			utc.setTime(Date.UTC(year, 3, 0));
			const march = utc.getUTCDate() - utc.getUTCDay();
			utc.setTime(Date.UTC(year, 10, 0));
			const october = utc.getUTCDate() - utc.getUTCDay();
			start = Date.UTC(year, 2, march, 1);
			end = Date.UTC(year, 9, october, 1);
		}
		offset = instant >= start && instant < end ? 2 : 1;
		local.setTime(instant + offset * 3600000);
		currentDate = local.toISOString().slice(0, 10);
		currentHour =
			local.getUTCHours() +
			local.getUTCMinutes() / 60 +
			local.getUTCSeconds() / 3600 +
			local.getUTCMilliseconds() / 3600000;
	}
	function set(value: string, h: number) {
		const valid = validSolarDate(value),
			[year, month, day] = valid.split("-").map(Number),
			hours = Number.isFinite(h) ? ((h % 24) + 24) % 24 : 15.5;
		instant =
			Date.parse(valid + "T00:00:00Z") +
			(hours - (euDst(year, month, day, hours) ? 2 : 1)) * 3600000;
		sync();
	}
	set(date, hour);
	return {
		set,
		advanceHours(h: number) {
			instant += h * 3600000;
			sync();
		},
		getHour: () => currentHour,
		getDate: () => currentDate,
		getOffset: () => offset,
		getInstant: () => instant,
	};
}
