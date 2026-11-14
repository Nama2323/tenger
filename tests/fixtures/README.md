# Test fixtures (real data, small)

| File | What it is | Source |
|---|---|---|
| `spherex_dr1_2025W33_2C_0321_1_D6.fits.gz` | 12 × 12 pixel SPHEREx DR1 Level 2 cutout, gzip, 11 kB. Extensions PRIMARY, IMAGE, FLAGS, VARIANCE, ZODI, WCS-WAVE kept byte-for-byte as astropy rewrote them. The EPSF table (441 rows, 3.8 MB) was removed. The primary header records `TGRSRC` (SHA-256 of the original download) and `TGRDROP = 'EPSF'`. | `https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/2025W33_2C/l2b-v27-2026-228/6/level2_2025W33_2C_0321_1D6_spx_l2b-v27-2026-228.fits?center=269.44648,4.76867&size=0.02`, downloaded 14 Nov 2026. Original 3,951,360 bytes, SHA-256 `f583dc85bf8685aba1ec699aa974ad1bfcd9b46ef274f6beaa8fa7c4a323e7c9`. |
| `sia_dr1_2025W33_2C_0321_1.csv` | Header plus the D3 and D6 rows of an IRSA SIA v2 CSV listing (`COLLECTION=spherex_dr1`, metadata only). | `https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_dr1&POS=circle 269.44648 4.76867 0.001&RESPONSEFORMAT=CSV`, 14 Nov 2026. |

**Exposure.** Observation `2025W33_2C_0321_1` (Barnard's Star field, 15 Aug 2025) is already in the
exposed set (`docs/EXPOSURE.md`): the earlier audit downloaded this same cutout, and the QR2 product of
the same exposure was bundled. Using it adds nothing new to the exposed set. Do not add fixtures made
from never-opened observations.

**Credit.** SPHEREx data from the NASA/IPAC Infrared Science Archive (IRSA), Caltech/JPL. Cite the
SPHEREx DR1 DOI listed by IRSA when these data appear in results.
