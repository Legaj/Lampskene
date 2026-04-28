// measuring-data.js
// Special hardcoded entries for categories not fully in matching-data.js
// getMeasuringLocs(subcat) merges these with MATCHING_DATA at runtime.

const MEASURING_EXTRA = {
  'Airport': [
    {id:'bromma_airport',   name:'Bromma flygplats',               lat:59.3544, lng:17.9416},
    {id:'arlanda_airport',  name:'Stockholm Arlanda flygplats',    lat:59.6519, lng:17.9186},
  ],
  'Rail Station': [
    {id:'sthlm_central',    name:'Stockholm Central',              lat:59.3309, lng:18.0590},
    {id:'sthlm_sodra',      name:'Stockholm Södra',                lat:59.3101, lng:18.0607},
    {id:'flemingsberg',     name:'Flemingsberg',                   lat:59.2175, lng:17.9457},
    {id:'sodertalje_c',     name:'Södertälje centrum',             lat:59.1952, lng:17.6249},
    {id:'sodertalje_syd',   name:'Södertälje Syd',                 lat:59.1565, lng:17.5862},
    {id:'jarna',            name:'Järna',                          lat:59.0912, lng:17.5595},
    {id:'gnesta',           name:'Gnesta',                         lat:59.0530, lng:17.3098},
    {id:'arlanda_c',        name:'Arlanda C',                      lat:59.6477, lng:17.9271},
    {id:'uppsala',          name:'Uppsala Central',                lat:59.8588, lng:17.6490},
    {id:'balsta',           name:'Bålsta',                         lat:59.5655, lng:17.5295},
    {id:'kungsangen',       name:'Kungsängen',                     lat:59.4827, lng:17.7534},
    {id:'marsta',           name:'Märsta',                         lat:59.6252, lng:17.8517},
    {id:'rosersberg',       name:'Rosersberg',                     lat:59.5983, lng:17.8965},
  ],
  'Aquarium': [
    {id:'skansen_akvariet', name:'Skansen Akvariet',               lat:59.3274, lng:18.1052},
    {id:'cosmonova',        name:'Cosmonova/Naturhistoriska',      lat:59.3696, lng:18.0536},
  ],
};

// Subcat → MATCHING_DATA key mapping
const MEASURING_MDKEY = {
  'SL Station':    'Train Station',
  'Park':          'Parks',
  'Amusement Park':'Amusement Parks',
  'Zoo':           'Zoos',
  'Golf Course':   'Golf Courses',
  'Museum':        'Museums',
  'Theatre':       'Theatres',
  'Hospital':      'Hospitals',
  'Library':       'Libraries',
  'Church':        'Churches',
  'IKEA':          '_IKEA',
  'Coop':          '_Coop',
};

function getMeasuringLocs(subcat) {
  if (MEASURING_EXTRA[subcat]) return MEASURING_EXTRA[subcat];
  const mdKey = MEASURING_MDKEY[subcat];
  if (!mdKey) return [];
  const md = typeof MATCHING_DATA !== 'undefined' ? MATCHING_DATA : {};
  if (mdKey === '_IKEA') {
    return (md['Supermarket'] || []).filter(x => x.name.toLowerCase().includes('ikea') || x.id.includes('ikea'));
  }
  if (mdKey === '_Coop') {
    return (md['Supermarket'] || []).filter(x => x.name.toLowerCase().includes('coop') || x.id.includes('coop'));
  }
  return md[mdKey] || [];
}

const MEASURING_SUBCATS = [
  'Airport', 'Rail Station', 'SL Station',
  'Amusement Park', 'Zoo', 'Aquarium',
  'Park', 'Golf Course',
  'Museum', 'Theatre', 'Hospital', 'Library', 'Church',
  'IKEA', 'Coop',
];
