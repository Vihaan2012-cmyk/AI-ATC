// Chart and airport information links for the given ICAO.
// Pure function providing public, free chart resources (OurAirports, sectionals, etc.).
// No network calls; purely deterministic URL generation based on ICAO.

export interface ChartLink {
  label: string;
  url: string;
}

/**
 * Get chart and airport information links for an airport.
 * Returns an array of public, free resources for charts, sectionals, and airport info.
 * URLs are deterministic and based solely on the ICAO code.
 *
 * @param icao - Airport ICAO code (case-insensitive)
 * @returns Array of chart resource links with label and URL
 */
export function chartLinks(icao: string): ChartLink[] {
  const normalized = (icao || '').toUpperCase().trim();

  if (!normalized) {
    return [];
  }

  // URL-encode the ICAO for use in query strings
  const encoded = encodeURIComponent(normalized);

  return [
    {
      label: 'OurAirports',
      url: `https://ourairports.com/airports/?q=${encoded}`,
    },
    {
      label: 'SkyVector Charts',
      url: `https://skyvector.com/?ll=${encoded}&chart=301`,
    },
    {
      label: 'ICAO Info',
      url: `https://checkwx.com/airports/${normalized}`,
    },
  ];
}
