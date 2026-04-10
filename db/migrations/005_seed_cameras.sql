-- 005_seed_cameras.sql
-- Seed: update feed name + 43 live traffic cameras worldwide

BEGIN;

-- Update feed
UPDATE feeds SET
  name = 'Traffic',
  slug = 'traffic-cameras',
  description = 'Bet on cars from around the world.'
WHERE id = '10000000-0000-0000-0000-000000000001';

-- Update bet type to 15s rounds
UPDATE bet_types SET round_duration_seconds = 15
WHERE feed_id = '10000000-0000-0000-0000-000000000001';

-- Cameras
INSERT INTO cameras (feed_id, external_id, name, image_url, source, timezone) VALUES
-- US East: New York
('10000000-0000-0000-0000-000000000001', 'nysdot-R11_173', 'I-678 Van Wyck Expwy - Queens, NYC', 'https://s53.nysdot.skyvdn.com:443/rtplive/R11_173/playlist.m3u8', 'nysdot', 'America/New_York'),
('10000000-0000-0000-0000-000000000001', 'nysdot-R4_052', 'I-490 @ NY 441 - Rochester, NY', 'https://s53.nysdot.skyvdn.com:443/rtplive/R4_052/playlist.m3u8', 'nysdot', 'America/New_York'),
('10000000-0000-0000-0000-000000000001', 'nysdot-R11_029', 'I-295 Cross Bronx @ E Tremont - Bronx, NYC', 'https://s53.nysdot.skyvdn.com:443/rtplive/R11_029/playlist.m3u8', 'nysdot', 'America/New_York'),
('10000000-0000-0000-0000-000000000001', 'nysdot-R11_082', 'I-278 BQE @ Metropolitan Ave - Brooklyn, NYC', 'https://s53.nysdot.skyvdn.com:443/rtplive/R11_082/playlist.m3u8', 'nysdot', 'America/New_York'),
('10000000-0000-0000-0000-000000000001', 'nysdot-R11_120', 'Grand Central Pkwy @ 55th Ave - Queens, NYC', 'https://s53.nysdot.skyvdn.com:443/rtplive/R11_120/playlist.m3u8', 'nysdot', 'America/New_York'),
('10000000-0000-0000-0000-000000000001', 'ny-harlem-river', 'Harlem River Drive @ 164th St - Manhattan', 'https://s9.nysdot.skyvdn.com:443/rtplive/R11_252/playlist.m3u8', 'nysdot', 'America/New_York'),
('10000000-0000-0000-0000-000000000001', 'ny-bqe-58th', 'I-278 BQE @ 58th St - Brooklyn', 'https://s9.nysdot.skyvdn.com:443/rtplive/R11_262/playlist.m3u8', 'nysdot', 'America/New_York'),
('10000000-0000-0000-0000-000000000001', 'ny-lie-cross-island', 'I-495 LIE @ Cross Island Pkwy - Queens', 'https://s9.nysdot.skyvdn.com:443/rtplive/R11_254/playlist.m3u8', 'nysdot', 'America/New_York'),
('10000000-0000-0000-0000-000000000001', 'ny-henry-hudson', 'Henry Hudson Pkwy @ W 66th St - Manhattan', 'https://s9.nysdot.skyvdn.com:443/rtplive/R11_242/playlist.m3u8', 'nysdot', 'America/New_York'),
-- US East: South Carolina
('10000000-0000-0000-0000-000000000001', 'sc-I85-mm55', 'I-85 South @ MM 55 - SC', 'https://s18.us-east-1.skyvdn.com:443/rtplive/30003/playlist.m3u8', '511sc', 'America/New_York'),
('10000000-0000-0000-0000-000000000001', 'sc-I85-mm57', 'I-85 South @ Airport Rd - Greer, SC', 'https://s18.us-east-1.skyvdn.com:443/rtplive/30006/playlist.m3u8', '511sc', 'America/New_York'),
('10000000-0000-0000-0000-000000000001', 'sc-I526-bridge', 'I-526 Don Holt Bridge - Charleston, SC', 'https://s18.us-east-1.skyvdn.com:443/rtplive/60026/playlist.m3u8', '511sc', 'America/New_York'),
('10000000-0000-0000-0000-000000000001', 'sc-I95-florence', 'I-95 @ I-20 - Florence, SC', 'https://s18.us-east-1.skyvdn.com:443/rtplive/50201/playlist.m3u8', '511sc', 'America/New_York'),
('10000000-0000-0000-0000-000000000001', 'sc-I26-columbia', 'I-26 @ I-126 Flyover - Columbia, SC', 'https://s18.us-east-1.skyvdn.com:443/rtplive/10017/playlist.m3u8', '511sc', 'America/New_York'),
('10000000-0000-0000-0000-000000000001', 'sc-I385-greenville', 'I-385 North - Greenville, SC', 'https://s18.us-east-1.skyvdn.com:443/rtplive/30091/playlist.m3u8', '511sc', 'America/New_York'),
-- US Central: Minnesota
('10000000-0000-0000-0000-000000000001', 'mndot-C8481', 'I-94 WB - Downtown St. Paul, MN', 'https://video.dot.state.mn.us/public/C8481.stream/playlist.m3u8', 'mndot', 'America/Chicago'),
('10000000-0000-0000-0000-000000000001', 'mndot-C8341', 'I-35W SB @ I-94 - Minneapolis, MN', 'https://video.dot.state.mn.us/public/C8341.stream/playlist.m3u8', 'mndot', 'America/Chicago'),
('10000000-0000-0000-0000-000000000001', 'mn-i35w-36th', 'I-35W NB @ 36th St - Minneapolis, MN', 'https://video.dot.state.mn.us/public/C6212.stream/playlist.m3u8', '511mn', 'America/Chicago'),
-- US Central: Iowa
('10000000-0000-0000-0000-000000000001', 'ia-i380-cedarrapids', 'I-380 @ 2nd St NE - Cedar Rapids, IA (4K)', 'https://iowadotsfs1.us-east-1.skyvdn.com:443/rtplive/wwdtv08lb/playlist.m3u8', '511ia', 'America/Chicago'),
('10000000-0000-0000-0000-000000000001', 'ia-us20-dubuque', 'US 20 @ Bryant St - Dubuque, IA', 'https://iowadotsfs1.us-east-1.skyvdn.com:443/rtplive/dqtv33lb/playlist.m3u8', '511ia', 'America/Chicago'),
-- US West: California
('10000000-0000-0000-0000-000000000001', 'ca-sr47-longbeach', 'SR-47 Pier A Way - Long Beach Port, CA', 'https://wzmedia.dot.ca.gov/D7/CCTV-959.stream/playlist.m3u8', 'caltrans', 'America/Los_Angeles'),
('10000000-0000-0000-0000-000000000001', 'ca-i80-emeryville', 'I-80 W of Ashby Ave - Emeryville, CA', 'https://wzmedia.dot.ca.gov/D4/E80_JWO_ASHBY_Av.stream/playlist.m3u8', 'caltrans', 'America/Los_Angeles'),
('10000000-0000-0000-0000-000000000001', 'ca-i10-westcovina', 'I-10 @ Azusa Ave - West Covina, CA', 'https://wzmedia.dot.ca.gov/D7/CCTV-418.stream/playlist.m3u8', 'caltrans', 'America/Los_Angeles'),
('10000000-0000-0000-0000-000000000001', 'ca-i110-torrance', 'I-110 @ Carson St - Torrance, CA', 'https://wzmedia.dot.ca.gov/D7/CCTV-799.stream/playlist.m3u8', 'caltrans', 'America/Los_Angeles'),
('10000000-0000-0000-0000-000000000001', 'ca-i710-longbeach', 'I-710 S of Willow St - Long Beach, CA', 'https://wzmedia.dot.ca.gov/D7/CCTV-263.stream/playlist.m3u8', 'caltrans', 'America/Los_Angeles'),
('10000000-0000-0000-0000-000000000001', 'ca-i405-carson', 'I-405 @ Main St - Carson, CA', 'https://wzmedia.dot.ca.gov/D7/CCTV-340.stream/playlist.m3u8', 'caltrans', 'America/Los_Angeles'),
-- France
('10000000-0000-0000-0000-000000000001', 'millau-viaduct', 'Millau Viaduct - A75, France', 'https://ds2-cache.quanteec.com/contents/encodings/live/f154fbd1-742e-4ed5-3335-3130-6d61-63-be54-7f8d574cdffed/master.m3u8', 'viewsurf', 'Europe/Paris'),
('10000000-0000-0000-0000-000000000001', 'nantua-viaduct', 'Nantua Viaduct - A40, France', 'https://deliverys4.quanteec.com/contents/encodings/vod/613c96ae-ef52-4428-3231-3030-6d61-63-a951-dd50cdc7d657d/master.m3u8', 'viewsurf', 'Europe/Paris'),
-- South Korea
('10000000-0000-0000-0000-000000000001', 'kr-gimpo-geolpo', 'Geolpo Intersection - Gimpo, South Korea', 'https://gimpo.cctvstream.net:8443/c048/playlist.m3u8', 'gimpo', 'Asia/Seoul'),
('10000000-0000-0000-0000-000000000001', 'kr-gimpo-gamjeong', 'Gamjeong Bridge - Gimpo, South Korea', 'https://gimpo.cctvstream.net:8443/c028/playlist.m3u8', 'gimpo', 'Asia/Seoul'),
('10000000-0000-0000-0000-000000000001', 'kr-daegu-traffic', 'Daegu Traffic - South Korea', 'https://carcctv.daegu.go.kr/live1/_definst_/ch268.stream/playlist.m3u8', 'daegu', 'Asia/Seoul'),
('10000000-0000-0000-0000-000000000001', 'kr-seoul-gangnam', 'Gangnam-daero, Yeomgok - Seoul', 'https://topiscctv1.eseoul.go.kr/sd2/ch46.stream/playlist.m3u8', 'topis-seoul', 'Asia/Seoul'),
('10000000-0000-0000-0000-000000000001', 'kr-seoul-samgakji', 'Hangangdaero @ Samgakji - Seoul', 'https://topiscctv1.eseoul.go.kr/sd1/ch9.stream/playlist.m3u8', 'topis-seoul', 'Asia/Seoul'),
('10000000-0000-0000-0000-000000000001', 'kr-spatic-worldcup', 'World Cup Stadium Rd - South Korea', 'https://strm1.spatic.go.kr/live/3.stream/playlist.m3u8', 'spatic', 'Asia/Seoul'),
('10000000-0000-0000-0000-000000000001', 'kr-roadplus-yangchon', 'Yangchon Pass Highway - South Korea', 'https://live2.exmobile.hscdn.com/exlive/cctv3314.stream/playlist.m3u8', 'roadplus', 'Asia/Seoul'),
-- Thailand
('10000000-0000-0000-0000-000000000001', 'th-highway-006', 'Highway Bang Muang - Thailand', 'https://streaming1.highwaytraffic.go.th/Phase3/PER_3_006_IN.stream/playlist.m3u8', 'thailand-doh', 'Asia/Bangkok'),
('10000000-0000-0000-0000-000000000001', 'th-highway-009', 'Highway Bang Kaeo - Thailand', 'https://streaming1.highwaytraffic.go.th/Phase3/PER_3_009_IN.stream/playlist.m3u8', 'thailand-doh', 'Asia/Bangkok'),
-- Norway
('10000000-0000-0000-0000-000000000001', 'no-e6-vestby', 'E6 @ Vestby towards Moss - Norway', 'https://kamera.vegvesen.no/public/0229013_1/manifest.m3u8', 'vegvesen', 'Europe/Oslo'),
('10000000-0000-0000-0000-000000000001', 'no-e18-sandvika', 'E18 @ Sandvika towards Oslo - Norway', 'https://kamera.vegvesen.no/public/0229009_1/manifest.m3u8', 'vegvesen', 'Europe/Oslo'),
-- Italy
('10000000-0000-0000-0000-000000000001', 'it-roma-venezia', 'Piazza Venezia - Rome, Italy', 'https://5e0add8153fcd.streamlock.net:1936/vedetta/piazza-venezia.stream/playlist.m3u8', 'vedetta', 'Europe/Rome'),
-- Turkey
('10000000-0000-0000-0000-000000000001', 'tr-kahramanmaras', 'Kahramanmaras City - Turkey', 'https://camstream.kahramanmaras.bel.tr/live/malik-ejder.stream/playlist.m3u8', 'kahramanmaras', 'Europe/Istanbul'),
-- Poland
('10000000-0000-0000-0000-000000000001', 'pl-warsaw', 'Warsaw Panorama - Poland', 'https://hoktastream2.webcamera.pl/warszawa_cam_a3caee/warszawa_cam_a3caee.stream/chunks.m3u8', 'webcamera', 'Europe/Warsaw'),
('10000000-0000-0000-0000-000000000001', 'pl-krakow', 'Krakow Main Square - Poland', 'https://hoktastream2.webcamera.pl/krakow_cam_702b61/krakow_cam_702b61.stream/chunks.m3u8', 'webcamera', 'Europe/Warsaw')
ON CONFLICT (feed_id, external_id) DO NOTHING;

COMMIT;
