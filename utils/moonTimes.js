// Lunar illumination and moonset, computed locally so the widget needs no second
// network request. Pure arithmetic: no GI namespace is imported, so both processes
// and a plain node test can run it.

const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const UNIX_EPOCH_JULIAN_DAY = 2440587.5;
// J2000.0, the epoch the orbital elements below are measured from.
const ELEMENTS_EPOCH_JULIAN_DAY = 2451543.5;
const MILLISECONDS_PER_DAY = 86400000;
const MILLISECONDS_PER_MINUTE = 60000;
const MINUTES_PER_DAY = 1440;
// The moon's upper limb touches the horizon at a slightly positive geometric altitude:
// its parallax (-0.95 deg) and atmospheric refraction (+0.57 deg) nearly cancel.
const MOON_HORIZON_ALTITUDE = 0.125;
const SCAN_STEP_MINUTES = 10;
const BISECTION_STEPS = 20;

function normalizeDegrees(degrees) {
    return ((degrees % 360) + 360) % 360;
}

function julianDay(dateMs) {
    return dateMs / MILLISECONDS_PER_DAY + UNIX_EPOCH_JULIAN_DAY;
}

/**
 * Illuminated fraction of the moon's disc at an instant, from the sun-moon elongation.
 *
 * `fraction` runs 0 at new moon to 1 at full. `waxing` is true while the disc is
 * growing, which is what decides which limb the phase glyph lights.
 */
export function moonIllumination(dateMs) {
    const d = julianDay(dateMs) - ELEMENTS_EPOCH_JULIAN_DAY;
    const moon = moonEquatorial(dateMs);
    const sunLongitude = sunEclipticLongitudeDegrees(d);

    const deltaLongitude = (moon.longitudeDegrees - sunLongitude) * DEGREES_TO_RADIANS;
    const latitude = moon.latitudeDegrees * DEGREES_TO_RADIANS;
    const cosElongation = Math.cos(latitude) * Math.cos(deltaLongitude);

    let phase = ((moon.longitudeDegrees - sunLongitude) % 360) / 360;
    if (phase < 0)
        phase += 1;

    return {
        fraction: (1 - cosElongation) / 2,
        waxing: phase < 0.5,
    };
}

/** Ecliptic longitude of the sun, in degrees, including the equation of centre. */
function sunEclipticLongitudeDegrees(d) {
    const meanAnomaly = 356.047 + 0.9856002585 * d;
    const perihelion = 282.9404 + 4.70935e-5 * d;
    const center = 1.914602 * Math.sin(meanAnomaly * DEGREES_TO_RADIANS)
        + 0.019993 * Math.sin(2 * meanAnomaly * DEGREES_TO_RADIANS)
        + 0.000289 * Math.sin(3 * meanAnomaly * DEGREES_TO_RADIANS);
    return meanAnomaly + center + perihelion;
}

/** Geocentric right ascension and declination of the moon, both in radians. */
function moonEquatorial(dateMs) {
    const d = julianDay(dateMs) - ELEMENTS_EPOCH_JULIAN_DAY;

    const sunMeanAnomaly = 356.047 + 0.9856002585 * d;
    const sunPerihelion = 282.9404 + 4.70935e-5 * d;
    const sunMeanLongitude = sunMeanAnomaly + sunPerihelion;

    const ascendingNode = 125.1228 - 0.0529538083 * d;
    const inclination = 5.1454;
    const periapsis = 318.0634 + 0.1643573223 * d;
    const semiMajorAxis = 60.2666;
    const eccentricity = 0.0549;
    const meanAnomaly = 115.3654 + 13.0649929509 * d;

    const meanAnomalyRadians = meanAnomaly * DEGREES_TO_RADIANS;
    let eccentricAnomaly = meanAnomalyRadians;
    for (let i = 0; i < 10; i++) {
        const delta = (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomalyRadians)
            / (1 - eccentricity * Math.cos(eccentricAnomaly));
        eccentricAnomaly -= delta;
        if (Math.abs(delta) < 1e-9)
            break;
    }

    const xOrbital = semiMajorAxis * (Math.cos(eccentricAnomaly) - eccentricity);
    const yOrbital = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(eccentricAnomaly);
    const trueAnomaly = Math.atan2(yOrbital, xOrbital);
    const radius = Math.hypot(xOrbital, yOrbital);

    const nodeRadians = ascendingNode * DEGREES_TO_RADIANS;
    const inclinationRadians = inclination * DEGREES_TO_RADIANS;
    const argument = trueAnomaly + periapsis * DEGREES_TO_RADIANS;

    const xEcliptic = radius * (Math.cos(nodeRadians) * Math.cos(argument)
        - Math.sin(nodeRadians) * Math.sin(argument) * Math.cos(inclinationRadians));
    const yEcliptic = radius * (Math.sin(nodeRadians) * Math.cos(argument)
        + Math.cos(nodeRadians) * Math.sin(argument) * Math.cos(inclinationRadians));
    const zEcliptic = radius * (Math.sin(argument) * Math.sin(inclinationRadians));

    let longitude = Math.atan2(yEcliptic, xEcliptic);
    let latitude = Math.atan2(zEcliptic, Math.hypot(xEcliptic, yEcliptic));

    // The largest periodic terms of the solar and lunar perturbations. Without them the
    // moon can sit up to ~1.5 degrees off, which moves a moonset time by minutes.
    const moonMeanLongitude = meanAnomaly + periapsis + ascendingNode;
    const elongation = moonMeanLongitude - sunMeanLongitude;
    const argumentOfLatitude = moonMeanLongitude - ascendingNode;
    const sinDeg = angle => Math.sin(angle * DEGREES_TO_RADIANS);
    const cosDeg = angle => Math.cos(angle * DEGREES_TO_RADIANS);

    const longitudePerturbationDegrees =
        -1.274 * sinDeg(meanAnomaly - 2 * elongation)
        + 0.658 * sinDeg(2 * elongation)
        - 0.186 * sinDeg(sunMeanAnomaly)
        - 0.059 * sinDeg(2 * meanAnomaly - 2 * elongation)
        - 0.057 * sinDeg(meanAnomaly - 2 * elongation + sunMeanAnomaly)
        + 0.053 * sinDeg(meanAnomaly + 2 * elongation)
        + 0.046 * sinDeg(2 * elongation - sunMeanAnomaly)
        + 0.041 * sinDeg(meanAnomaly - sunMeanAnomaly)
        - 0.035 * sinDeg(elongation)
        - 0.031 * sinDeg(meanAnomaly + sunMeanAnomaly)
        - 0.015 * sinDeg(2 * argumentOfLatitude - 2 * elongation)
        + 0.011 * sinDeg(meanAnomaly - 4 * elongation);

    const latitudePerturbationDegrees =
        -0.173 * sinDeg(argumentOfLatitude - 2 * elongation)
        - 0.055 * sinDeg(meanAnomaly - argumentOfLatitude - 2 * elongation)
        - 0.046 * sinDeg(meanAnomaly + argumentOfLatitude - 2 * elongation)
        + 0.033 * sinDeg(argumentOfLatitude + 2 * elongation)
        + 0.017 * sinDeg(2 * meanAnomaly + argumentOfLatitude);

    const distancePerturbation = -0.58 * cosDeg(meanAnomaly - 2 * elongation)
        - 0.46 * cosDeg(2 * elongation);

    longitude += longitudePerturbationDegrees * DEGREES_TO_RADIANS;
    latitude += latitudePerturbationDegrees * DEGREES_TO_RADIANS;
    const perturbedRadius = radius + distancePerturbation;

    const obliquity = (23.4393 - 3.563e-7 * d) * DEGREES_TO_RADIANS;
    const xEquatorial = perturbedRadius * Math.cos(longitude) * Math.cos(latitude);
    const yEquatorial = perturbedRadius * Math.sin(longitude) * Math.cos(latitude);
    const zEquatorial = perturbedRadius * Math.sin(latitude);

    const yRotated = yEquatorial * Math.cos(obliquity) - zEquatorial * Math.sin(obliquity);
    const zRotated = yEquatorial * Math.sin(obliquity) + zEquatorial * Math.cos(obliquity);

    return {
        rightAscension: Math.atan2(yRotated, xEquatorial),
        declination: Math.atan2(zRotated, Math.hypot(xEquatorial, yRotated)),
        longitudeDegrees: longitude * RADIANS_TO_DEGREES,
        latitudeDegrees: latitude * RADIANS_TO_DEGREES,
        sunMeanLongitude,
    };
}

/** Geometric altitude of the moon above the horizon, in degrees. */
function moonAltitudeDegrees(dateMs, latitudeDegrees, longitudeDegrees) {
    const { rightAscension, declination, sunMeanLongitude } = moonEquatorial(dateMs);

    const utHours = ((dateMs % MILLISECONDS_PER_DAY) + MILLISECONDS_PER_DAY) % MILLISECONDS_PER_DAY
        / 3600000;
    // GMST0 is the sidereal time at 0h UT; adding UT advances it to the instant.
    const greenwichSiderealDegrees = sunMeanLongitude + 180 + utHours * 15;
    const localSiderealDegrees = greenwichSiderealDegrees + longitudeDegrees;
    const hourAngle = localSiderealDegrees * DEGREES_TO_RADIANS - rightAscension;

    const latitude = latitudeDegrees * DEGREES_TO_RADIANS;
    const sine = Math.sin(latitude) * Math.sin(declination)
        + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
    return Math.asin(Math.max(-1, Math.min(1, sine))) * RADIANS_TO_DEGREES;
}

/**
 * Local minutes past midnight at which the moon sets, or null when it does not set on
 * that day. `dayStartEpochMs` is the UTC instant of the location's local midnight.
 */
export function moonSetMinutes(latitudeDegrees, longitudeDegrees, dayStartEpochMs) {
    let previousAltitude = moonAltitudeDegrees(dayStartEpochMs, latitudeDegrees, longitudeDegrees);

    for (let minute = SCAN_STEP_MINUTES; minute <= MINUTES_PER_DAY; minute += SCAN_STEP_MINUTES) {
        const dateMs = dayStartEpochMs + minute * MILLISECONDS_PER_MINUTE;
        const altitude = moonAltitudeDegrees(dateMs, latitudeDegrees, longitudeDegrees);
        const crossing = previousAltitude > MOON_HORIZON_ALTITUDE && altitude <= MOON_HORIZON_ALTITUDE;
        if (crossing) {
            let lowMinute = minute - SCAN_STEP_MINUTES;
            let highMinute = minute;
            for (let i = 0; i < BISECTION_STEPS; i++) {
                const midMinute = (lowMinute + highMinute) / 2;
                const midAltitude = moonAltitudeDegrees(
                    dayStartEpochMs + midMinute * MILLISECONDS_PER_MINUTE,
                    latitudeDegrees, longitudeDegrees);
                if (midAltitude > MOON_HORIZON_ALTITUDE)
                    lowMinute = midMinute;
                else
                    highMinute = midMinute;
            }
            return (lowMinute + highMinute) / 2;
        }
        previousAltitude = altitude;
    }

    return null;
}
