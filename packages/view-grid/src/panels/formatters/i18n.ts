import type { Messages } from '@kedalion/ui';

export const en = {
  'dash.fmt.panel': 'JSON and XML formatters',
  'dash.fmt.panel.description': 'Paste JSON or XML, then format, minify or validate it. Errors show the line and column.',
  'dash.fmt.format': 'Format',
  'dash.fmt.minify': 'Minify',
  'dash.fmt.validate': 'Validate',
  'dash.fmt.copy': 'Copy',
  'dash.fmt.valid': 'Valid {mode}',
  'dash.fmt.error': 'Line {line}:{col} - {message}',
  'dash.fmt.placeholder.json': 'Paste JSON here',
  'dash.fmt.placeholder.xml': 'Paste XML here',
} as const;

export const ptBR: Messages<typeof en> = {
  'dash.fmt.panel': 'Formatadores JSON e XML',
  'dash.fmt.panel.description': 'Cole JSON ou XML e formate, minifique ou valide. Os erros mostram a linha e a coluna.',
  'dash.fmt.format': 'Formatar',
  'dash.fmt.minify': 'Minificar',
  'dash.fmt.validate': 'Validar',
  'dash.fmt.copy': 'Copiar',
  'dash.fmt.valid': '{mode} válido',
  'dash.fmt.error': 'Linha {line}:{col} - {message}',
  'dash.fmt.placeholder.json': 'Cole o JSON aqui',
  'dash.fmt.placeholder.xml': 'Cole o XML aqui',
};
