import { createLightTheme, type BrandVariants } from '@fluentui/react-components';

const brand: BrandVariants = {
  10: '#03060B',
  20: '#0E1A2B',
  30: '#132A48',
  40: '#16365E',
  50: '#194375',
  60: '#1B508C',
  70: '#1D5DA3',
  80: '#1F6BBA',
  90: '#3B7EC6',
  100: '#5690CF',
  110: '#6EA2D7',
  120: '#86B4DF',
  130: '#9EC5E7',
  140: '#B6D6EE',
  150: '#CEE6F5',
  160: '#E6F2FB',
};

export const theme = createLightTheme(brand);
