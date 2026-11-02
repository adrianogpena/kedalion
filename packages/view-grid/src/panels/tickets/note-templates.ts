export interface NoteTemplate {
  id: string;
  name: string;
  body: string;
}

export interface TemplateVars {
  key: string;
  title: string;
  url: string;
}

/** The template body with `{{key}}`, `{{title}}` and `{{url}}` replaced; unknown placeholders stay as typed. */
export function applyTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{\s*(key|title|url)\s*\}\}/g, (_m, name: keyof TemplateVars) => vars[name]);
}
