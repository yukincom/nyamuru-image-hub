import pose10 from '../assets/human-pose-cat/10.webp?url';
import pose11 from '../assets/human-pose-cat/11.webp?url';
import pose12 from '../assets/human-pose-cat/12.webp?url';
import pose13 from '../assets/human-pose-cat/13.webp?url';
import pose14 from '../assets/human-pose-cat/14.webp?url';
import pose15 from '../assets/human-pose-cat/15.webp?url';
import pose16 from '../assets/human-pose-cat/16.webp?url';
import pose17 from '../assets/human-pose-cat/17.webp?url';
import pose20 from '../assets/human-pose-cat/20.webp?url';
import pose21 from '../assets/human-pose-cat/21.webp?url';
import pose22 from '../assets/human-pose-cat/22.webp?url';
import pose23 from '../assets/human-pose-cat/23.webp?url';
import pose24 from '../assets/human-pose-cat/24.webp?url';
import pose25 from '../assets/human-pose-cat/25.webp?url';
import pose26 from '../assets/human-pose-cat/26.webp?url';
import pose27 from '../assets/human-pose-cat/27.webp?url';
import pose28 from '../assets/human-pose-cat/28.webp?url';
import pose30 from '../assets/human-pose-cat/30.webp?url';
import pose31 from '../assets/human-pose-cat/31.webp?url';
import pose32 from '../assets/human-pose-cat/32.webp?url';
import pose33 from '../assets/human-pose-cat/33.webp?url';
import pose34 from '../assets/human-pose-cat/34.webp?url';
import pose35 from '../assets/human-pose-cat/35.webp?url';
import pose36 from '../assets/human-pose-cat/36.webp?url';
import pose37 from '../assets/human-pose-cat/37.webp?url';
import pose41 from '../assets/human-pose-cat/41.webp?url';
import pose42 from '../assets/human-pose-cat/42.webp?url';
import pose43 from '../assets/human-pose-cat/43.webp?url';
import pose44 from '../assets/human-pose-cat/44.webp?url';
import pose50 from '../assets/human-pose-cat/50.webp?url';

// 表示番号の再利用で別ポーズへ絵が付かないよう、登録済みの固定IDで対応づける。
export const HUMAN_POSE_PREVIEW_ART: Readonly<Record<string, string | undefined>> = {
  'pose-mh-standing01': pose10,
  'pose-mh-standing02': pose11,
  'pose-mh-standing03': pose12,
  'pose-mh-standing04': pose13,
  'pose-mh-anrico-standing11': pose14,
  'pose-mh-anrico-standing10': pose15,
  'pose-mh-drednicolson-arms-akimbo': pose16,
  'pose-mh-sohh-sohh-embarrassed': pose17,
  'pose-mh-standing05': pose20,
  'pose-mh-punkduck-hand-on-shoulder-01': pose21,
  'pose-mh-punkduck-hand-on-shoulder-03': pose22,
  'pose-mh-punkduck-pd-fashion01': pose23,
  'pose-mh-punkduck-pd-fashion02': pose24,
  'pose-mh-punkduck-train-departure': pose25,
  'pose-mh-sohh-posing1': pose26,
  'pose-mh-sohh-posing2': pose27,
  'pose-mh-gpedroso-peace-and-love': pose28,
  'pose-mh-sit01': pose30,
  'pose-mh-anrico-sitting02': pose31,
  'pose-mh-anrico-sitting04': pose32,
  'pose-mh-anrico-sitting10': pose33,
  'pose-mh-milkman-sit-01a': pose34,
  'pose-mh-wolgade-sit-on-ground-01': pose35,
  'pose-mh-sweetan008-sitting-pose': pose36,
  'pose-mh-elvs-what-have-i-done': pose37,
  'pose-mh-mindfront-sitting-in-armchair-holding-wine-glass': pose41,
  'pose-mh-jjones-leaning-on-counter-hands-folded': pose42,
  'pose-mh-mindfront-standing-holding-wine-glass': pose43,
  'pose-mh-punkduck-pd-fashion-handbag': pose44,
  'pose-mh-run01': pose50,
};
