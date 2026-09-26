/**
 * achievements.defs — catálogo declarativo de logros.
 *
 * DATOS, no lógica: para añadir/cambiar un logro basta una fila
 * (requisito de administración: requisitos configurables sin tocar
 * el evaluador). El stat referencia claves de `STATS` en
 * `lib/achievements.ts` — claves estables, cambiarlas rompe progreso
 * acumulado histórico (lección BGA).
 *
 * Los nombres rinden homenaje a frases y memes míticos del videojuego,
 * el cine, las series y el anime/manga: el mismo patrón que usan Portal,
 * Minecraft o Slay the Spire para que desbloquearlos arranque una
 * sonrisa. La descripción SIEMPRE explica el requisito real — el guiño
 * nunca oculta cómo conseguirlo.
 */

import type { AchievementCategory } from './achievements';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  category: AchievementCategory;
  target: number;
  stat: string;
}

export const DEFS: AchievementDef[] = [
  // ── Progresión ────────────────────────────────────────────────────
  // «Thank you Mario! But our princess is in another castle» (SMB)
  { id: 'first_game', name: 'Otro castillo', desc: 'Termina tu primera partida. La princesa estaba en otra partida.',
    category: 'progreso', target: 1, stat: 'games' },
  // «First Blood» — la primera victoria mítica de cualquier MOBA
  { id: 'first_win', name: 'Primera sangre', desc: 'Gana tu primera partida. La Horda nunca olvida.',
    category: 'progreso', target: 1, stat: 'wins' },
  // «It’s dangerous to go alone! Take this.» (Zelda) — ir acompañado de
  // afición creciente
  { id: 'games_10', name: 'Toma esto', desc: 'Termina 10 partidas. Es peligroso jugar solo tantas.',
    category: 'progreso', target: 10, stat: 'games' },
  // «One more turn» — el meme de Civilization sobre no poder dejar de jugar
  { id: 'games_25', name: 'Un turno más', desc: 'Termina 25 partidas. Una más y lo dejas.',
    category: 'progreso', target: 25, stat: 'games' },
  // «Finish him!» (Mortal Kombat)
  { id: 'wins_10', name: '¡Acabad con ella!', desc: 'Gana 10 partidas. La Horda pide FINISH HIM.',
    category: 'progreso', target: 10, stat: 'wins' },

  // ── Héroes ────────────────────────────────────────────────────────
  // «Gotta catch ’em all!» (Pokémon) — colección completa
  { id: 'hero_8', name: '¡Hazte con todos!', desc: 'Juega con los 8 héroes. Como un pokédex, pero con espadas.',
    category: 'heroes', target: 8, stat: 'heroesTried' },
  // «Mi main» — argot gaming: tu personaje principal
  { id: 'hero_5', name: 'Mi main', desc: 'Juega 5 partidas con el mismo héroe. Todo main que se precie.',
    category: 'heroes', target: 5, stat: 'mostPlayedHero' },
  // «There can be only one» (Highlander) — victoria con cada héroe
  { id: 'hero_wins_8', name: 'Solo puede quedar uno', desc: 'Gana una partida con cada héroe. Los ocho Highlander.',
    category: 'heroes', target: 8, stat: 'heroesWon' },

  // ── Reto ──────────────────────────────────────────────────────────
  // Cadena de gloria estilo Cupcake/Fruitcake/Vanilla Crazy Cake (Portal)
  { id: 'score_15', name: 'Una chispa de gloria', desc: 'Gana una partida con 15+ de Gloria. El sol aún no amanece.',
    category: 'reto', target: 15, stat: 'bestScore' },
  { id: 'score_30', name: 'Brilla con luz propia', desc: 'Gana una partida con 30+ de Gloria. Ya deslumbra.',
    category: 'reto', target: 30, stat: 'bestScore' },
  // «Praise the Sun! [T]/» (Dark Souls) — Gloria máxima = sol máximo
  { id: 'score_45', name: 'Alabad el Sol', desc: 'Gana una partida con 45+ de Gloria. [T]/ ¡Jolly cooperation!',
    category: 'reto', target: 45, stat: 'bestScore' },
  // «IDDQD» — el cheat de God Mode del DOOM original
  { id: 'flawless', name: 'IDDQD', desc: 'Gana una partida sin heridas (Tenaz). God mode activado.',
    category: 'reto', target: 1, stat: 'flawlessWins' },
  // «Unstoppable!» — las kill streaks de Dota/LoL
  { id: 'streak_3', name: 'Imparable', desc: 'Gana 3 partidas seguidas. La racha no se detiene.',
    category: 'reto', target: 3, stat: 'winStreak' },
  // «Rip and tear, until it is done» (DOOM)
  { id: 'warlords_3', name: 'Destruid y desgarrad', desc: 'Derrota a 3 Señores de la Guerra. Hasta que acabe.',
    category: 'reto', target: 3, stat: 'warlordsDefeated' },
  // «Hola. Me llamo Íñigo Montoya. Mataste a mi padre. Prepárate a morir.»
  // (La Princesa Prometida, cine)
  { id: 'warlord_self', name: 'Íñigo Montoya', desc: 'Derrota tú personalmente a un Señor de la Guerra. Tenías que saldar la cuenta.',
    category: 'reto', target: 1, stat: 'warlordsByMe' },
  // «You shall not pass!» (El Señor de los Anillos, cine/libro)
  { id: 'no_pass', name: '¡No podrás pasar!', desc: 'Gana una partida donde caiga al menos un Señor de la Guerra. La Horda no pasó.',
    category: 'reto', target: 1, stat: 'warlordGamesWon' },
  // «Tis but a scratch» / «just a flesh wound» (Monty Python, cine)
  { id: 'flesh_wound', name: 'Es solo un rasguño', desc: 'Gana una partida terminando con 3+ heridas. El Rey Negro estaría de acuerdo.',
    category: 'reto', target: 1, stat: 'woundedWins' },
  // «I'll be back» (Terminator, cine) — victoria tras 3+ derrotas seguidas
  { id: 'terminator', name: 'Volveré', desc: 'Gana una partida después de perder 3 o más seguidas. La Horda no te esperaba de vuelta.',
    category: 'reto', target: 1, stat: 'comebackWins' },
  // «Toss a coin to your Witcher» (The Witcher: libro → videojuego → serie)
  { id: 'witcher_coin', name: 'Tira una moneda a tu brujo', desc: 'Termina una partida con 15+ Monedas sin gastar. Oh Valle del botín.',
    category: 'reto', target: 15, stat: 'coinsMax' },
  // «¡Shinzou wo sasageyo!» (Shingeki no Kyojin, anime/manga)
  { id: 'aot_hearts', name: '¡Dedicad vuestros corazones!', desc: 'Derrota a 25 enemigos en total. Por la libertad de la mesa.',
    category: 'reto', target: 25, stat: 'enemiesTotal' },
  // «¡PLUS ULTRA!» (My Hero Academia, anime/manga) — marca personal
  { id: 'plus_ultra', name: '¡Plus Ultra!', desc: 'Logra una puntuación personal de 30+ Gloria. Más allá de tu mejor marca.',
    category: 'reto', target: 30, stat: 'bestPersonalScore' },
  // «Speedrun Any%» — cultura speedrunner
  { id: 'fast_win', name: 'Speedrun: Any%', desc: 'Gana una partida en 40 turnos o menos. Sin glitches, todo mérito.',
    category: 'reto', target: 1, stat: 'fastWins' },
  // «Shut up and take my money!» (Futurama — meme universal de compras)
  { id: 'market_3', name: '¡Cállate y toma mi dinero!', desc: 'Compra 3 cartas del Mercado en una partida. El tendero lo entiende.',
    category: 'reto', target: 3, stat: 'marketBuysMax' },
  // «The Doomslayer» (DOOM Eternal)
  { id: 'slayer_10', name: 'El Carnicero de Orcos', desc: 'Derrota a 10 enemigos en total. El único que temen.',
    category: 'reto', target: 10, stat: 'enemiesTotal' },

  // ── Modos ─────────────────────────────────────────────────────────
  // «Forever alone» — meme clásico de Rage Comics
  { id: 'solo_3', name: 'Forever alone', desc: 'Juega 3 partidas en Solitario. La mesa también está bien así.',
    category: 'modos', target: 3, stat: 'soloGames' },
  // «I am the night» + conquista solitaria
  { id: 'solo_win', name: '1 contra todos', desc: 'Gana una partida en Solitario. Tú contra la Horda entera.',
    category: 'modos', target: 1, stat: 'soloWins' },
  // «Fusión!» (Dragon Ball) — dos clases en un héroe
  { id: 'multiclass', name: '¡Fusión!', desc: 'Juega una partida Multiclase. Ve a ver el poder de la fusión.',
    category: 'modos', target: 1, stat: 'multiclassGames' },
  // «See that mountain? You can climb it.» (Skyrim)
  { id: 'scenarios_3', name: 'Ves esa montaña', desc: 'Juega 3 partidas con escenarios. Puedes escalarla.',
    category: 'modos', target: 3, stat: 'scenarioGames' },
  // «GG EZ» — la frase célebre (y polémica) tras una victoria online
  { id: 'online_3', name: 'GG EZ', desc: 'Gana una partida online de 3+ jugadores. Escribe GG en el chat.',
    category: 'modos', target: 1, stat: 'onlineWins' },
  // «Un anillo para gobernarlos a todos» → La Comunidad del Anillo (LOTR):
  // partidas cooperativas en mesa online
  { id: 'fellowship', name: 'La Comunidad del Anillo', desc: 'Juega 5 partidas online de 3+ jugadores. No hacen falta nueve compañeros.',
    category: 'modos', target: 5, stat: 'onlineGames' },

  // ── Taller ────────────────────────────────────────────────────────
  // «PC Master Race» — el sacrosanto culto a los mods
  { id: 'custom_1', name: 'Con mods se juega mejor', desc: 'Juega una partida con contenido del Taller. Bienvenido al modding.',
    category: 'taller', target: 1, stat: 'customGames' },

  // ── Meta-logro ────────────────────────────────────────────────────
  // «All your base are belong to us» (Zero Wing) — todas las cartas son
  // nuestras: el cierre perfecto para un juego de cartas.
  { id: 'completista', name: 'Todas tus cartas nos pertenecen', desc: 'Desbloquea todos los demás logros. No queda nada por capturar.',
    category: 'reto', target: 1, stat: '_meta' },
];
