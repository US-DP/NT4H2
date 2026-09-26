/** Mock de lucide-react-native — iconos como componentes stub. */

import React from 'react';

const makeIcon = (name: string) => {
  const C = (props: any) => React.createElement(name, props);
  C.displayName = name;
  return C;
};

export const Crosshair = makeIcon('IconCrosshair');
export const Home = makeIcon('IconHome');
export const Swords = makeIcon('IconSwords');
export const DoorOpen = makeIcon('IconDoorOpen');
export const Palette = makeIcon('IconPalette');
export const BookOpen = makeIcon('IconBookOpen');
export const Book = makeIcon('IconBook');
export const Settings = makeIcon('IconSettings');
export const X = makeIcon('IconX');
export const Check = makeIcon('IconCheck');
export const Lock = makeIcon('IconLock');
export const Trophy = makeIcon('IconTrophy');
export const Coins = makeIcon('IconCoins');
export const Shield = makeIcon('IconShield');
export const Sword = makeIcon('IconSword');
export const Send = makeIcon('IconSend');
export const Save = makeIcon('IconSave');
export const LogOut = makeIcon('IconLogOut');
export const MessageSquare = makeIcon('IconMessageSquare');
export const Info = makeIcon('IconInfo');
export const Hand = makeIcon('IconHand');
export const ScrollText = makeIcon('IconScrollText');
export const Heart = makeIcon('IconHeart');
export const Star = makeIcon('IconStar');
export const Sparkles = makeIcon('IconSparkles');
export const LibraryBig = makeIcon('IconLibraryBig');
export const Trash2 = makeIcon('IconTrash2');
export const AlertTriangle = makeIcon('IconAlertTriangle');
export const RotateCcw = makeIcon('IconRotateCcw');
