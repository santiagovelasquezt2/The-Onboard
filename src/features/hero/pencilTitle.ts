export const HERO_PENCIL_TITLE_ADVANCE = 5041
export const HERO_PENCIL_TITLE_BASELINE = 800
// Match the settled ScribbleFont stroke weight so the hand-off is invisible.
export const HERO_PENCIL_STROKE_WIDTH = 90
// 1.25× duration equals a 25% slower writing speed.
export const HERO_PENCIL_TIMING_SCALE = 1.25
export const HERO_PENCIL_REVEAL_DURATION_MS = Math.ceil(
  2330 * HERO_PENCIL_TIMING_SCALE,
)

export interface HeroPencilStroke {
  d: string
  delay: number
  duration: number
  length: number
}

// These centerlines define the perceived hand/pencil order for the title reveal.
export const HERO_PENCIL_STROKES: HeroPencilStroke[] = [
  { d: 'M48 187 C184 158 382 108 548 112', delay: 0, duration: 130, length: 507 },
  { d: 'M324 174 C307 310 314 560 338 775', delay: 78, duration: 190, length: 603 },
  { d: 'M670 110 C652 315 654 545 650 735', delay: 220, duration: 165, length: 626 },
  { d: 'M678 545 C737 456 808 385 870 392 C949 405 949 522 914 747', delay: 310, duration: 205, length: 642 },
  { d: 'M1107 494 C1150 418 1214 355 1270 360 C1327 387 1334 447 1307 467 C1263 497 1193 479 1105 500 C1095 626 1142 724 1230 744 C1300 752 1360 716 1414 690', delay: 470, duration: 205, length: 1055 },
  { d: 'M1535 526 C1584 519 1641 521 1695 516', delay: 620, duration: 80, length: 161 },
  { d: 'M1992 738 C1845 755 1774 635 1819 448 C1855 294 1965 150 2068 150 C2184 189 2238 289 2220 405 C2195 586 2111 704 1992 738', delay: 685, duration: 250, length: 1576 },
  { d: 'M2390 445 C2403 540 2440 655 2420 760', delay: 875, duration: 120, length: 319 },
  { d: 'M2424 570 C2484 442 2560 365 2608 380 C2702 429 2715 596 2774 774', delay: 930, duration: 185, length: 717 },
  { d: 'M2880 115 C2875 328 2925 560 2918 766', delay: 1085, duration: 150, length: 653 },
  { d: 'M2938 520 C2997 482 3060 434 3100 450 C3176 480 3152 612 3062 682 C3015 720 2966 720 2938 680', delay: 1175, duration: 195, length: 601 },
  { d: 'M3390 742 C3290 720 3275 610 3326 468 C3368 370 3451 330 3515 385 C3591 448 3560 595 3480 685 C3442 728 3410 742 3390 742', delay: 1345, duration: 210, length: 1008 },
  { d: 'M3712 689 C3702 577 3777 426 3890 363 C3953 342 4002 374 3990 446', delay: 1520, duration: 180, length: 555 },
  { d: 'M3715 694 C3790 671 3924 559 4087 505 C4135 548 4125 690 4158 774', delay: 1620, duration: 185, length: 700 },
  { d: 'M4255 410 C4268 544 4258 670 4268 762', delay: 1760, duration: 125, length: 353 },
  { d: 'M4318 584 C4368 455 4456 367 4510 368 C4546 385 4572 399 4592 370', delay: 1815, duration: 150, length: 393 },
  { d: 'M4982 115 C4960 317 5007 560 5000 765', delay: 1935, duration: 165, length: 651 },
  { d: 'M4960 482 C4883 410 4804 393 4732 493 C4655 600 4685 732 4730 741 C4803 724 4894 648 4964 570', delay: 2035, duration: 215, length: 839 },
]
