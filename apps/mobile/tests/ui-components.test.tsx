/**
 * Tests para los nuevos componentes UI.
 *
 * Cubre:
 * - PhaseIndicator (UI-071, UI-072)
 * - ConnectionStatus (UI-190..195)
 * - ActionHistory (UI-170..174)
 * - ContextualActions (UI-120..124)
 * - ChoiceDialog (UI-130..135)
 * - CardZoom (UI-110..113)
 * - EmptyState (UI-350)
 * - ErrorMessage (UI-354..356)
 * - ChatPanel (UI-180..189)
 */

import { describe, it, expect, vi } from 'vitest';
import { Text } from 'react-native';
import { render, expectText, findAllText, press } from './renderer';

import { PhaseIndicator } from '../components/PhaseIndicator';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { ActionHistory } from '../components/ActionHistory';
import { ContextualActions } from '../components/ContextualActions';
import { ChoiceDialog } from '../components/ChoiceDialog';
import { CardZoom } from '../components/CardZoom';
import { EmptyState } from '../components/EmptyState';
import { ErrorMessage } from '../components/ErrorMessage';
import { ChatPanel } from '../components/ChatPanel';
import { HeroDetail } from '../components/HeroDetail';
import { SaveIndicator } from '../components/SaveIndicator';
import { ExitGameDialog } from '../components/ExitGameDialog';
import { HelpButton } from '../components/HelpButton';
import { Tutorial } from '../components/Tutorial';
import { KeywordTooltip } from '../components/KeywordTooltip';

import type { CardDefinition } from '@nt4h/schema';

function makeCardDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id: 'test-card',
    name: 'Carta Test',
    type: 'ABILITY',
    heroClass: 'WARRIOR',
    copies: 1,
    printedAttack: 3,
    effects: [
      { type: 'GAIN_COINS', amount: { kind: 'CONSTANT', value: 1 } },
      { type: 'END_ATTACK' },
    ],
    verificationStatus: 'OCR',
    ...overrides,
  } as CardDefinition;
}

// ============================================================================
// PhaseIndicator
// ============================================================================

describe('PhaseIndicator — UI-071, UI-072', () => {
  it('muestra las fases en orden', () => {
    const { root } = render(<PhaseIndicator phase="PLAYER_ATTACK" turnNumber={1} />);
    expectText(root, 'Ataque');
    expectText(root, 'Mercado');
    expectText(root, 'Restablecimiento');
  });

  it('la fase activa se destaca visualmente', () => {
    const { root } = render(<PhaseIndicator phase="PLAYER_ATTACK" turnNumber={1} />);
    expectText(root, '⚔ Ataque');
    // La fase pasada/futura aparece con menor contraste
    expectText(root, 'Mercado');
  });

  it('muestra fases especiales fuera del flujo', () => {
    const { root } = render(<PhaseIndicator phase="HORDE_ATTACK" turnNumber={2} />);
    expectText(root, 'Ataque de la Horda');
  });
});

// ============================================================================
// ConnectionStatus
// ============================================================================

describe('ConnectionStatus — UI-190..195', () => {
  it('muestra conexión local', () => {
    const { root } = render(<ConnectionStatus state="LOCAL" />);
    expectText(root, 'Partida local');
  });

  it('muestra sin conexión con explicación no intrusiva', () => {
    const { root } = render(<ConnectionStatus state="OFFLINE" />);
    expectText(root, 'Sin conexión');
    expectText(root, 'Las funciones online no están disponibles');
  });

  it('muestra resumen de reconexión', () => {
    const { root } = render(<ConnectionStatus state="SYNCING" reconnectSummary={['Jugador 2 terminó su ataque']} />);
    expectText(root, 'Sincronizando');
    expectText(root, 'Jugador 2 terminó su ataque');
  });
});

// ============================================================================
// ActionHistory
// ============================================================================

describe('ActionHistory — UI-170..174', () => {
  it('muestra entradas del historial', () => {
    const entries = [
      {
        id: '1',
        turn: 1,
        actor: 'Alejandro',
        action: 'jugó Disparo certero',
        card: 'Disparo Certero',
        target: 'Orco 3',
        result: 'Infligió 3 de daño. Orco 3 derrotado.',
        timestamp: 0,
      },
    ];
    const { root } = render(<ActionHistory entries={entries} currentTurn={1} />);
    expectText(root, 'Alejandro');
    expectText(root, 'Disparo Certero');
    expectText(root, 'Orco 3');
  });

  it('filtra por turno actual', () => {
    const entries = [
      { id: '1', turn: 1, actor: 'A', action: 'a', result: 'r', timestamp: 0 },
      { id: '2', turn: 2, actor: 'B', action: 'b', result: 'r', timestamp: 0 },
    ];
    const { root } = render(<ActionHistory entries={entries} currentTurn={2} filter="turn" />);
    expectText(root, 'B');
  });
});

// ============================================================================
// ContextualActions
// ============================================================================

describe('ContextualActions — UI-120..124', () => {
  it('muestra acciones según fase de ataque', () => {
    const actions = [
      { id: 'end-attack', label: 'Finalizar ataque', primary: true, onPress: vi.fn() },
      { id: 'use-ability', label: 'Usar poder', onPress: vi.fn() },
    ];
    const { root } = render(<ContextualActions actions={actions} />);
    expectText(root, 'Finalizar ataque');
    expectText(root, 'Usar poder');
  });

  it('muestra acción peligrosa con estilo diferente', () => {
    const actions = [
      { id: 'abandon', label: 'Abandonar partida', dangerous: true, onPress: vi.fn() },
    ];
    const { root } = render(<ContextualActions actions={actions} />);
    expectText(root, 'Abandonar partida');
  });

  it('muestra motivo de acción deshabilitada', () => {
    const actions = [
      { id: 'buy', label: 'Comprar', disabled: true, disabledReason: 'Sin monedas', onPress: vi.fn() },
    ];
    const { root } = render(<ContextualActions actions={actions} />);
    expectText(root, 'Sin monedas');
  });
});

// ============================================================================
// ChoiceDialog
// ============================================================================

describe('ChoiceDialog — UI-130..135', () => {
  it('muestra instrucción y opciones', () => {
    const onSelect = vi.fn();
    const { root } = render(
      <ChoiceDialog
        visible={true}
        source="Disparo Certero"
        decider="Alejandro"
        instruction="Selecciona un enemigo."
        options={[
          { id: 'e1', label: 'Orco 1' },
          { id: 'e2', label: 'Orco 2', disabled: true, disabledReason: 'Ya derrotado' },
        ]}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );
    expectText(root, 'Disparo Certero');
    expectText(root, 'Selecciona un enemigo.');
    expectText(root, 'Orco 1');
    expectText(root, 'Orco 2');
    expectText(root, 'Ya derrotado');
  });

  it('muestra esperando decisión de otro jugador', () => {
    const { root } = render(
      <ChoiceDialog
        visible={true}
        source="Turno"
        decider="Lucía"
        instruction="Esperando."
        options={[]}
        waitingForOther={true}
        onSelect={vi.fn()}
      />,
    );
    expectText(root, 'Esperando una decisión de Lucía');
  });
});

// ============================================================================
// CardZoom
// ============================================================================

describe('CardZoom — UI-110..113', () => {
  it('muestra información de carta ampliada', () => {
    const card = makeCardDef({ name: 'Disparo Certero', printedAttack: 3, heroClass: 'EXPLORER' });
    const { root } = render(<CardZoom visible={true} card={card} onClose={vi.fn()} />);
    expectText(root, 'Disparo Certero');
    expectText(root, 'Cómo se resuelve');
    expectText(root, 'Inflige 3 de daño.');
  });

  it('oculta información privada si no está autorizado', () => {
    const card = makeCardDef({ type: 'HORDE', name: 'Orco' });
    const { root } = render(<CardZoom visible={true} card={card} authorized={false} onClose={vi.fn()} />);
    expectText(root, 'Información privada oculta');
  });
});

// ============================================================================
// EmptyState
// ============================================================================

describe('EmptyState — UI-350', () => {
  it('muestra guía al siguiente paso', () => {
    const primary = vi.fn();
    const { root } = render(
      <EmptyState
        title="Biblioteca vacía"
        description="Aún no tienes cartas guardadas."
        primaryAction={{ label: 'Crear primera', onPress: primary }}
        helpAction={{ label: 'Ver ayuda', onPress: vi.fn() }}
      />,
    );
    expectText(root, 'Biblioteca vacía');
    expectText(root, 'Aún no tienes cartas guardadas.');
    expectText(root, 'Crear primera');
  });
});

// ============================================================================
// ErrorMessage
// ============================================================================

describe('ErrorMessage — UI-354..356', () => {
  it('explica error con acción, causa y corrección', () => {
    const { root } = render(
      <ErrorMessage
        category="validation"
        action="Comprar carta"
        reason="No tienes monedas suficientes."
        fix="Gana más monedas o elige un objeto más barato."
      />,
    );
    expectText(root, 'Error de validación');
    expectText(root, 'Comprar carta');
    expectText(root, 'No tienes monedas suficientes.');
    expectText(root, 'Gana más monedas');
  });

  it('ofrece acción recuperable', () => {
    const retry = vi.fn();
    const { root } = render(
      <ErrorMessage
        category="connection"
        action="Enviar comando"
        reason="Sin conexión con el servidor."
        actions={[{ label: 'Reintentar', onPress: retry }]}
      />,
    );
    const texts = findAllText(root);
    expect(texts.some((t) => t.includes('Reintentar'))).toBe(true);
  });
});

// ============================================================================
// ChatPanel
// ============================================================================

describe('ChatPanel — UI-180..189', () => {
  it('muestra lista de mensajes', () => {
    const messages = [
      { id: '1', sender: 'Alejandro', text: 'Hola', type: 'USER' as const, timestamp: 0 },
      { id: '2', sender: 'Sistema', text: 'Partida iniciada', type: 'SYSTEM' as const, timestamp: 0 },
    ];
    const { root } = render(<ChatPanel messages={messages} currentUser="Alejandro" onSend={vi.fn()} />);
    expectText(root, 'Hola');
    expectText(root, 'Sistema');
    expectText(root, 'Partida iniciada');
  });

  it('muestra contador de no leídos', () => {
    const { root } = render(
      <ChatPanel messages={[]} currentUser="Alejandro" onSend={vi.fn()} unreadCount={3} onClose={vi.fn()} />,
    );
    expectText(root, '3');
  });

  it('indica que no hay adjuntos en MVP', () => {
    const { root } = render(<ChatPanel messages={[]} currentUser="Alejandro" onSend={vi.fn()} draftText="" />);
    expectText(root, 'Adjuntos no disponibles');
  });
});

// ============================================================================
// HeroDetail
// ============================================================================

describe('HeroDetail — UI-084..085', () => {
  it('muestra nombre, clase y capacidades del héroe', () => {
    const hero = makeCardDef({
      id: 'hero.aranel',
      name: 'Aranel',
      heroClass: 'EXPLORER',
      capabilities: ['RANGED'],
    } as any);
    const { root } = render(<HeroDetail visible={true} hero={hero} onClose={vi.fn()} />);
    expectText(root, 'Aranel');
    expectText(root, 'EXPLORER');
    expectText(root, 'RANGED');
  });

  it('muestra usos de la pericia', () => {
    const hero = makeCardDef({
      id: 'hero.aranel',
      name: 'Aranel',
      heroAbility: { uses: 2, effects: [{ type: 'DRAW' }] },
    } as any);
    const { root } = render(<HeroDetail visible={true} hero={hero} usesRemaining={1} onClose={vi.fn()} />);
    expectText(root, 'Usos: 1/2');
  });
});

// ============================================================================
// SaveIndicator
// ============================================================================

describe('SaveIndicator — UI-201', () => {
  it('muestra estado guardando', () => {
    const { root } = render(<SaveIndicator state="saving" />);
    expectText(root, 'Guardando...');
  });

  it('muestra estado guardado', () => {
    const { root } = render(<SaveIndicator state="saved" lastSavedAt={0} />);
    expectText(root, 'Guardado');
  });

  it('no renderiza nada en estado idle', () => {
    const { root } = render(<SaveIndicator state="idle" />);
    expect(root).toEqual([]);
  });
});

// ============================================================================
// ExitGameDialog
// ============================================================================

describe('ExitGameDialog — UI-024', () => {
  it('muestra opciones con cambios sin guardar', () => {
    const { root } = render(
      <ExitGameDialog
        visible={true}
        hasUnsavedChanges={true}
        onSaveAndExit={vi.fn()}
        onExitWithoutSaving={vi.fn()}
        onAbandon={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expectText(root, 'Guardar y salir');
    expectText(root, 'Salir sin guardar');
    expectText(root, 'Abandonar partida');
  });

  it('muestra confirmar salir sin cambios', () => {
    const { root } = render(
      <ExitGameDialog
        visible={true}
        hasUnsavedChanges={false}
        onSaveAndExit={vi.fn()}
        onExitWithoutSaving={vi.fn()}
        onAbandon={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expectText(root, 'Salir');
    expectText(root, 'Abandonar partida');
  });
});

// ============================================================================
// HelpButton
// ============================================================================

describe('HelpButton — UI-223', () => {
  it('llama a onPress al pulsar', () => {
    const onPress = vi.fn();
    const { root } = render(<HelpButton onPress={onPress} />);
    press(root);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Tutorial
// ============================================================================

describe('Tutorial — UI-220..222', () => {
  it('muestra el primer paso', () => {
    const { root } = render(
      <Tutorial
        visible={true}
        currentStep={0}
        steps={[
          { title: 'Bienvenido', body: 'Este es el tutorial.', context: 'Inicio' },
          { title: 'Turno', body: 'Cada turno tiene fases.' },
        ]}
        onClose={vi.fn()}
      />,
    );
    expectText(root, 'Bienvenido');
    expectText(root, 'Este es el tutorial.');
    expectText(root, 'Paso 1 de 2');
  });

  it('muestra botón de finalizar en el último paso', () => {
    const { root } = render(
      <Tutorial
        visible={true}
        currentStep={0}
        steps={[{ title: 'Fin', body: 'Has terminado.' }]}
        onClose={vi.fn()}
      />,
    );
    expectText(root, 'Finalizar');
  });
});

// ============================================================================
// KeywordTooltip
// ============================================================================

describe('KeywordTooltip — UI-224', () => {
  it('muestra el contenido hijo', () => {
    const { root } = render(
      <KeywordTooltip keyword="Gloria" description="Puntos de victoria." visible={true}>
        <Text>Gloria</Text>
      </KeywordTooltip>,
    );
    expectText(root, 'Gloria');
    expectText(root, 'Puntos de victoria');
  });
});
