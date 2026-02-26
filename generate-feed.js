/**
 * Facebook Dynamic Ads Feed Generator for Borås Bil
 * Fetches vehicles from Borås Bil search API (Wayke-powered)
 * Runs on GitHub Actions every hour
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const API_URL = 'https://borasbil-search.rivercode.io/api/vehicles/search?hits=500';
const OUTPUT_DIR = './output';
const OUTPUT_FILE = 'feed.xml';

/**
 * Fetch vehicles from Borås Bil search API
 */
function fetchVehicles() {
  return new Promise((resolve, reject) => {
    const url = new URL(API_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'Authorization': 'Bearer 1|1BTHS49tk9yLRHSqQcBPpYguV6Lgzw1hrbjb07Cg',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.data || !Array.isArray(json.data)) {
            reject(new Error('Invalid API response: missing data array'));
            return;
          }
          const total = json.meta?.total_count_for_query || json.data.length;
          console.log(`Fetched ${json.data.length} of ${total} vehicles`);
          resolve(json.data);
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Escape XML special characters
 */
function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Map fuel type from Swedish to Facebook format
 */
function mapFuelType(fuelType) {
  const mapping = {
    'Laddhybrid': 'Plug-in Hybrid',
    'El': 'Electric',
    'Elektrisk': 'Electric',
    'Bensin': 'Gasoline',
    'Diesel': 'Diesel',
    'Elhybrid': 'Hybrid'
  };
  return mapping[fuelType] || fuelType;
}

/**
 * Map transmission type
 */
function mapTransmission(gearboxType) {
  const mapping = { 'Automat': 'Automatic', 'Manuell': 'Manual' };
  return mapping[gearboxType] || gearboxType;
}

/**
 * Get body style from model series
 */
function getBodyStyle(modelSeries) {
  const suvModels = ['XC40', 'XC60', 'XC90', 'EX30', 'EX90', 'Q3', 'Q5', 'X1', 'X3', 'X5',
    'Sportage', 'Tucson', 'Kona', 'Niro', 'Sorento', 'EV3', 'EV6', 'EV9',
    'C5 Aircross', '3008', '5008', 'e-2008', 'ID.4', 'ID.5', 'Tiguan', 'T-Cross',
    'Karoq', 'Kodiaq', 'Enyaq', 'Kamiq', 'Forester', 'Outback', 'RAV4', 'C-HR',
    'Yaris Cross', 'bZ4X', 'CX-30', 'CX-5', 'CX-60', 'MX-30'];
  const wagonModels = ['V60', 'V90', 'Superb Kombi', 'Octavia Kombi', 'Megane Sport Tourer'];
  if (suvModels.some(s => modelSeries?.includes(s))) return 'SUV';
  if (wagonModels.some(s => modelSeries?.includes(s))) return 'Wagon';
  return 'Sedan';
}

/**
 * Determine vehicle condition based on model year
 */
function getVehicleCondition(modelYear) {
  const currentYear = new Date().getFullYear();
  return modelYear >= currentYear ? 'NEW' : 'USED';
}

/**
 * Format description from vehicle data
 */
function formatDescription(vehicle) {
  const parts = [];
  if (vehicle.short_description) parts.push(vehicle.short_description);
  if (vehicle.mileage) parts.push(`Miltal: ${vehicle.mileage.toLocaleString('sv-SE')} mil`);
  if (vehicle.model_year) parts.push(`Årsmodell: ${vehicle.model_year}`);
  if (vehicle.gearbox_type) parts.push(`Växellåda: ${vehicle.gearbox_type}`);
  if (vehicle.fuel_type) parts.push(`Bränsle: ${vehicle.fuel_type}`);
  if (vehicle.registration_number) parts.push(`Reg.nr: ${vehicle.registration_number}`);
  parts.push('Kontakta oss för mer information.');
  return parts.join('. ');
}

/**
 * Get best image URL from vehicle data
 */
function getImageUrl(vehicle) {
  const formats = vehicle.featured_image?.formats;
  if (!formats) return '';
  if (formats.f_800x?.jpeg) return formats.f_800x.jpeg;
  if (formats.f_770x514?.jpeg) return formats.f_770x514.jpeg;
  const first = Object.values(formats)[0];
  return first?.jpeg || '';
}

/**
 * Generate XML feed in RSS 2.0 format for Facebook Dynamic Ads
 */
function generateXMLFeed(vehicles) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n';
  xml += '  <channel>\n';
  xml += '    <title>Borås Bil - Begagnade Bilar</title>\n';
  xml += '    <link>https://borasbil.se</link>\n';
  xml += '    <description>Borås Bil Vehicle Inventory</description>\n';

  let processedCount = 0;
  let skippedCount = 0;

  vehicles.forEach(vehicle => {
    if (!vehicle.id || !vehicle.manufacturer || !vehicle.price) {
      skippedCount++;
      return;
    }

    xml += '    <item>\n';

    // IDs
    xml += `    <g:id>${escapeXml(vehicle.id)}</g:id>\n`;
    xml += '    <g:google_product_category>916</g:google_product_category>\n';
    xml += '    <g:fb_product_category>173</g:fb_product_category>\n';
    xml += `    <vehicle_id>${escapeXml(vehicle.id)}</vehicle_id>\n`;

    // Registration
    if (vehicle.registration_number) {
      xml += `    <vehicle_registration_plate>${escapeXml(vehicle.registration_number)}</vehicle_registration_plate>\n`;
    }

    // Title
    const titleParts = [vehicle.manufacturer];
    if (vehicle.model_series) titleParts.push(vehicle.model_series);
    if (vehicle.short_description) titleParts.push(vehicle.short_description);
    const title = titleParts.join(' ').substring(0, 200);
    xml += `    <g:title>${escapeXml(title)}</g:title>\n`;
    xml += `    <title>${escapeXml(title)}</title>\n`;

    // Description
    const description = formatDescription(vehicle);
    xml += `    <g:description>${escapeXml(description)}</g:description>\n`;
    xml += `    <description>${escapeXml(description)}</description>\n`;

    // URL
    const vehicleUrl = `https://borasbil.se/bilar/${vehicle.slug}`;
    xml += `    <g:link>${escapeXml(vehicleUrl)}</g:link>\n`;
    xml += `    <link>${escapeXml(vehicleUrl)}</link>\n`;
    xml += `    <url>${escapeXml(vehicleUrl)}</url>\n`;

    // Brand
    xml += `    <g:brand>${escapeXml(vehicle.manufacturer)}</g:brand>\n`;
    xml += `    <brand>${escapeXml(vehicle.manufacturer)}</brand>\n`;
    xml += `    <make>${escapeXml(vehicle.manufacturer)}</make>\n`;

    // Image
    const imageUrl = getImageUrl(vehicle);
    if (imageUrl) {
      xml += `    <g:image_link>${escapeXml(imageUrl)}</g:image_link>\n`;
      xml += '    <image>\n';
      xml += `      <url>${escapeXml(imageUrl)}</url>\n`;
      xml += '      <tag>Exterior</tag>\n';
      xml += '    </image>\n';
    }

    // Model
    if (vehicle.model_series) {
      xml += `    <model>${escapeXml(vehicle.model_series)}</model>\n`;
    }

    // Year
    if (vehicle.model_year) {
      xml += `    <year>${vehicle.model_year}</year>\n`;
    }

    // Mileage (Swedish mil -> km)
    if (vehicle.mileage) {
      xml += '    <mileage>\n';
      xml += `      <value>${vehicle.mileage * 10}</value>\n`;
      xml += '      <unit>KM</unit>\n';
      xml += '    </mileage>\n';
    }

    // Body style
    xml += `    <body_style>${getBodyStyle(vehicle.model_series || '')}</body_style>\n`;

    // Fuel type
    if (vehicle.fuel_type) {
      xml += `    <fuel_type>${escapeXml(mapFuelType(vehicle.fuel_type))}</fuel_type>\n`;
    }

    // Transmission
    if (vehicle.gearbox_type) {
      xml += `    <transmission>${mapTransmission(vehicle.gearbox_type)}</transmission>\n`;
    }

    // Price
    const price = `${vehicle.price} SEK`;
    xml += `    <g:price>${price}</g:price>\n`;
    xml += `    <price>${price}</price>\n`;
    xml += `    <sale_price>${price}</sale_price>\n`;

    // Address / dealer
    if (vehicle.branch) {
      xml += '    <address format="simple">\n';
      xml += `      <component name="addr1">${escapeXml(vehicle.branch.name)}</component>\n`;
      xml += '      <component name="country">SE</component>\n';
      xml += '    </address>\n';
      xml += `    <dealer_id>${escapeXml(vehicle.branch.id)}</dealer_id>\n`;
    }

    // Availability
    xml += '    <g:availability>in stock</g:availability>\n';
    xml += '    <availability>in stock</availability>\n';

    // Condition
    const state = getVehicleCondition(vehicle.model_year || 0);
    const condition = state === 'NEW' ? 'new' : 'used';
    xml += `    <g:condition>${condition}</g:condition>\n`;
    xml += `    <condition>${condition}</condition>\n`;
    xml += `    <state_of_vehicle>${state}</state_of_vehicle>\n`;

    xml += '    </item>\n';
    processedCount++;
  });

  xml += '  </channel>\n';
  xml += '</rss>';

  console.log(`Generated feed with ${processedCount} vehicles`);
  if (skippedCount > 0) console.log(`Skipped ${skippedCount} vehicles (missing required data)`);
  return { xml, processedCount };
}

/**
 * Map branch name to city
 */
function getBranchCity(branchName) {
  const mapping = {
    'Borås Bil': 'Borås',
    'Kinna Bil': 'Kinna',
    'Bogesunds Bil Ulricehamn': 'Ulricehamn'
  };
  return mapping[branchName] || branchName || '';
}

/**
 * Escape CSV field (wrap in quotes if needed)
 */
function escapeCsv(value) {
  if (!value && value !== 0) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes(';')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Generate CSV feed for Facebook Automotive Catalog
 * Uses Facebook's required columns for vehicle listings
 */
function generateCSVFeed(vehicles) {
  const headers = [
    'vehicle_id',
    'title',
    'description',
    'url',
    'make',
    'model',
    'year',
    'mileage.value',
    'mileage.unit',
    'body_style',
    'fuel_type',
    'transmission',
    'price',
    'sale_price',
    'image[0].url',
    'image[0].tag',
    'condition',
    'state_of_vehicle',
    'availability',
    'vehicle_registration_plate',
    'address.addr1',
    'address.city',
    'address.region',
    'address.country',
    'dealer_id',
    'brand'
  ];

  let csv = headers.join(',') + '\n';
  let processedCount = 0;

  vehicles.forEach(vehicle => {
    if (!vehicle.id || !vehicle.manufacturer || !vehicle.price) return;

    const titleParts = [vehicle.manufacturer];
    if (vehicle.model_series) titleParts.push(vehicle.model_series);
    if (vehicle.short_description) titleParts.push(vehicle.short_description);
    const title = titleParts.join(' ').substring(0, 200);

    const description = formatDescription(vehicle);
    const vehicleUrl = `https://borasbil.se/bilar/${vehicle.slug}`;
    const imageUrl = getImageUrl(vehicle);
    const state = getVehicleCondition(vehicle.model_year || 0);
    const condition = state === 'NEW' ? 'new' : 'used';

    const row = [
      escapeCsv(vehicle.id),
      escapeCsv(title),
      escapeCsv(description),
      escapeCsv(vehicleUrl),
      escapeCsv(vehicle.manufacturer),
      escapeCsv(vehicle.model_series || ''),
      escapeCsv(vehicle.model_year || ''),
      escapeCsv(vehicle.mileage ? vehicle.mileage * 10 : ''),
      escapeCsv('KM'),
      escapeCsv(getBodyStyle(vehicle.model_series || '')),
      escapeCsv(vehicle.fuel_type ? mapFuelType(vehicle.fuel_type) : ''),
      escapeCsv(vehicle.gearbox_type ? mapTransmission(vehicle.gearbox_type) : ''),
      escapeCsv(`${vehicle.price} SEK`),
      escapeCsv(`${vehicle.price} SEK`),
      escapeCsv(imageUrl),
      escapeCsv('Exterior'),
      escapeCsv(condition),
      escapeCsv(state),
      escapeCsv('in stock'),
      escapeCsv(vehicle.registration_number || ''),
      escapeCsv(vehicle.branch?.name || ''),
      escapeCsv(getBranchCity(vehicle.branch?.name)),
      escapeCsv('Västra Götalands län'),
      escapeCsv('SE'),
      escapeCsv(vehicle.branch?.id || ''),
      escapeCsv(vehicle.manufacturer)
    ];

    csv += row.join(',') + '\n';
    processedCount++;
  });

  console.log(`Generated CSV feed with ${processedCount} vehicles`);
  return { csv, processedCount };
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log('Starting Borås Bil feed generation...');
    console.log(`Fetching from: ${API_URL}`);

    const vehicles = await fetchVehicles();
    const { xml, processedCount } = generateXMLFeed(vehicles);

    if (processedCount === 0) {
      throw new Error('No vehicles processed! Check API response.');
    }

    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
    fs.writeFileSync(outputPath, xml, 'utf8');
    console.log(`Saved XML feed to: ${outputPath}`);
    console.log(`XML file size: ${(xml.length / 1024).toFixed(2)} KB`);

    // Generate CSV feed
    const csvResult = generateCSVFeed(vehicles);
    const csvPath = path.join(OUTPUT_DIR, 'feed.csv');
    fs.writeFileSync(csvPath, '\uFEFF' + csvResult.csv, 'utf8'); // BOM for Excel compatibility
    console.log(`Saved CSV feed to: ${csvPath}`);
    console.log(`CSV file size: ${(csvResult.csv.length / 1024).toFixed(2)} KB`);

    // Index page
    const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Borås Bil Facebook Feed</title>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    .info { background: #f0f0f0; padding: 20px; border-radius: 5px; }
    .feed-url { background: #e8f5e9; padding: 15px; border-radius: 5px; margin: 20px 0; word-break: break-all; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Borås Bil Facebook Dynamic Ads Feed</h1>
  <div class="info">
    <h2>Feed URL</h2>
    <div class="feed-url">
      <strong>Use this URL in Facebook Commerce Manager:</strong><br><br>
      <code id="feedUrl">Loading...</code>
    </div>
    <h2>Status</h2>
    <p>Feed is active and updating automatically every hour</p>
    <p>Last updated: <strong>${new Date().toLocaleString('sv-SE')}</strong></p>
    <p>Total vehicles: <strong>${processedCount}</strong></p>
    <h2>Quick Links</h2>
    <ul>
      <li><a href="feed.xml">View XML Feed</a></li>
      <li><a href="https://business.facebook.com/commerce/" target="_blank">Facebook Commerce Manager</a></li>
      <li><a href="https://borasbil.se" target="_blank">Borås Bil Website</a></li>
    </ul>
  </div>
  <script>
    const feedUrl = window.location.origin + window.location.pathname.replace(/index\\.html$/, '') + 'feed.xml';
    document.getElementById('feedUrl').textContent = feedUrl;
  </script>
</body>
</html>`;

    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), indexHtml, 'utf8');
    console.log('Created index.html');
    console.log('Feed generation complete!');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
