# VANDARA RUSH

Open-world crime game di kota fiktif **Vandara Bay** — kota teluk tropis
dengan boulevard pantai, pasar lentera, plaza menara kaca, dan dockyard
industri. Damian Reyes, pengemudi muda yang pulang ke kota, mengambil
pekerjaan dari Tante Soraya (fixer sekaligus pemilik bengkel) sementara
Inspektur Bramantyo yang korup memburunya dan bos sindikat pelabuhan
Victor Halim menarik benang dari belakang. Delapan misi cerita berakhir
dengan pelarian hydrofoil tengah malam.

Dibangun 100% offline dengan Three.js (r159, di-vendor di
`game/vendor/`), tanpa build step, tanpa aset eksternal.

## Cara jalanin

```sh
node serve.ts
# buka http://localhost:8080
```

## Kontrol

| Input | Aksi |
| --- | --- |
| WASD | Jalan / nyetir |
| Shift | Lari / nitro (di mobil) |
| Space | Lompat / handbrake drift (di mobil) |
| F | Masuk / keluar mobil |
| Klik kiri | Tembak |
| Klik kanan (tahan) | Aim + crosshair |
| 1–4 | Ganti senjata (Tinju / Pistol / SMG / Shotgun) |
| R | Reload |
| Q | Ganti stasiun radio |
| E | Interaksi (toko / bengkel / safehouse) |
| P atau Esc | Pause (peta kota penuh) |

## Sistem

- **Misi (8):** First Delivery, Lantern Chase, Dockyard Heist, Soraya's
  Escort, Apex Repo, Vault at Golden Pier, Double Cross, Last Hydrofoil
  Out. Misi aktif ditandai tiang cahaya emas di titik target; dialog
  karakter tampil lengkap dengan potret.
- **Wanted (0–5 bintang):** panas naik saat menembak, menabrak, atau
  mencuri mobil. Bintang 1–2: mobil patroli mengejar. Bintang 3:
  roadblock. Bintang 4–5: unit taktis bersenjata + helikopter polisi
  dengan sorot lampu. Lolos dari pandangan cukup lama bikin bintang turun.
- **Kendaraan (7):** Apex GT (sport coupe teal milik Damian), sedan,
  taksi kuning, SUV, truk kargo, motor, hydrofoil. Fisik arcade:
  drift handbrake + asap ban, nitro + api knalpot, kerusakan + asap
  dan ledakan.
- **Toko / bengkel / safehouse:** toko senjata Kencana (beli senjata +
  amunisi), bengkel Soraya (perbaiki + cat ulang mobil), safehouse
  Damian (pulihkan health + save).
- **Radio:** VANDARA 104.2 FM dan GELOMBANG 88.8 FM (synth Web Audio,
  tombol Q).
- **Save:** otomatis tiap misi selesai + via safehouse; tombol Continue
  di title screen.

## Struktur file

```text
main.ts          bundler entri (salin game/ + screenshots/ ke /output,
                 tulis dossier.json via vendor/makefun-game.ts)
serve.ts         server statis dev (node serve.ts -> :8080)
shots.json       4 screenshot + query ?shot= masing-masing
screenshots/    01-cover.jpg, 02-night-pursuit.jpg,
                 03-onfoot-combat.jpg, 04-world-map.jpg
game/index.html  entry point + HUD DOM
game/vendor/     three.min.js r159 (+ LICENSE)
game/src/
  config.js      palet, distrik, senjata, kendaraan, misi, radio
  input.js       keyboard + mouse + pointer lock
  audio.js       mesin, sirene, radio, SFX (Web Audio)
  world.js       renderer, langit golden-hour/malam, laut, jalan
  roads.js       graf jalan (dipakai traffic, polisi, minimap)
  buildings.js   kota prosedural: gedung, kontainer, tenda, palem
  vehicles.js    pabrik + fisik mobil (semua tipe)
  traffic.js     mobil sipil di jalan
  pedestrians.js pejalan kaki (panik saat tembakan/sirene)
  player.js      Damian jalan kaki + kamera chase mobil
  police.js      wanted, patroli, roadblock, taktis, helikopter
  combat.js      4 senjata: muzzle flash, tracer, shake
  missions.js    8 misi + beacon emas + dialog
  economy.js     uang, respect, toko, bengkel, safehouse
  save.js        save/load localStorage
  effects.js     partikel (asap, api, ledakan) + screen shake
  hud.js         HUD DOM: misi, uang, jam, bintang, speedo, senjata
  minimap.js     radar bundar + blip polisi/misi/toko
  menus.js       title, pause + peta kota penuh + legenda
  shots.js       staging deterministik ?shot= untuk screenshot
  main.js        boot + loop utama (fixed timestep 1/60)
  hud.css        style HUD + menu
```

## Screenshot staging

Buka `game/index.html?shot=<nama>` untuk frame yang sudah di-stage:

- `?shot=cover` — Apex GT drift di boulevard Golden Pier, dikejar
  polisi + helikopter, misi 1 aktif.
- `?shot=night` — malam neon, wanted 4, roadblock di Pasar Lentera.
- `?shot=combat` — baku tembak jalan kaki dengan SMG.
- `?shot=map` — menu pause + peta kota penuh + waypoint misi.
