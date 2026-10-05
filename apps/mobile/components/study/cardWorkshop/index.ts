/**
 * cardWorkshop — API pública del módulo del editor de efectos.
 * Los consumidores internos importan los submódulos directamente
 * (model/compiler/decompile); este barrel lo usa el test de paridad
 * del Taller y queda como superficie pública del módulo.
 */

export * from './model';
export * from './registry';
export * from './compiler';
export * from './decompile';
export * from './validation';
export * from './text';
export * from './simulate';
