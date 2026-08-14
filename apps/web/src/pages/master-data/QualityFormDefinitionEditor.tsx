import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import type { QualityFormComponentType, QualityFormSection } from './types.js';
import { componentLabel, defaultConfig, QUALITY_COMPONENT_TYPES } from './quality-form-ui.js';

export function QualityFormDefinitionEditor({
  sections,
  onChange,
  error,
}: {
  sections: QualityFormSection[];
  onChange: (sections: QualityFormSection[]) => void;
  error?: string;
}) {
  const updateSection = (index: number, update: Partial<QualityFormSection>) =>
    onChange(
      sections.map((section, position) =>
        position === index ? { ...section, ...update } : section,
      ),
    );
  return (
    <div className="space-y-4">
      {sections.map((section, sectionIndex) => (
        <fieldset
          key={sectionIndex}
          className="space-y-3 rounded-md border border-border-subtle p-4"
        >
          <div className="flex items-end gap-3">
            <TextField
              label={`Section ${sectionIndex + 1} title *`}
              value={section.title}
              width="fill"
              onChange={(event) => updateSection(sectionIndex, { title: event.target.value })}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={sections.length === 1}
              onClick={() =>
                onChange(
                  sections
                    .filter((_, index) => index !== sectionIndex)
                    .map((item, index) => ({ ...item, sequence: index + 1 })),
                )
              }
            >
              Remove section
            </Button>
          </div>
          {section.components.map((component, componentIndex) => (
            <div
              key={componentIndex}
              className="grid gap-3 rounded bg-[var(--erp-surface-subtle)] p-3 md:grid-cols-2"
            >
              <SelectField
                label="Component type"
                value={component.type}
                onValueChange={(value) => {
                  const type = value as QualityFormComponentType;
                  updateSection(sectionIndex, {
                    components: section.components.map((item, index) =>
                      index === componentIndex
                        ? {
                            ...item,
                            type,
                            title: componentLabel(type),
                            config: defaultConfig(type),
                          }
                        : item,
                    ),
                  });
                }}
              >
                {QUALITY_COMPONENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {componentLabel(type)}
                  </SelectItem>
                ))}
              </SelectField>
              <TextField
                label="Component title *"
                value={component.title}
                width="fill"
                onChange={(event) =>
                  updateSection(sectionIndex, {
                    components: section.components.map((item, index) =>
                      index === componentIndex ? { ...item, title: event.target.value } : item,
                    ),
                  })
                }
              />
              <label className="md:col-span-2">
                <span className="mb-1 block text-sm font-medium">
                  Controlled configuration (JSON)
                </span>
                <textarea
                  className="min-h-28 w-full rounded-md border border-border-subtle bg-[var(--erp-surface)] p-3 font-mono text-sm"
                  value={JSON.stringify(component.config, null, 2)}
                  onChange={(event) => {
                    try {
                      const config = JSON.parse(event.target.value) as Record<string, unknown>;
                      updateSection(sectionIndex, {
                        components: section.components.map((item, index) =>
                          index === componentIndex ? { ...item, config } : item,
                        ),
                      });
                    } catch {
                      /* Keep the last structurally valid configuration. */
                    }
                  }}
                />
              </label>
              <div className="md:col-span-2 flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={section.components.length === 1}
                  onClick={() =>
                    updateSection(sectionIndex, {
                      components: section.components
                        .filter((_, index) => index !== componentIndex)
                        .map((item, index) => ({ ...item, sequence: index + 1 })),
                    })
                  }
                >
                  Remove component
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              updateSection(sectionIndex, {
                components: [
                  ...section.components,
                  {
                    sequence: section.components.length + 1,
                    type: 'COMMENTS',
                    title: 'Comments',
                    description: null,
                    config: defaultConfig('COMMENTS'),
                  },
                ],
              })
            }
          >
            Add component
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() =>
          onChange([
            ...sections,
            {
              sequence: sections.length + 1,
              title: 'New section',
              description: null,
              components: [
                {
                  sequence: 1,
                  type: 'COMMENTS',
                  title: 'Comments',
                  description: null,
                  config: defaultConfig('COMMENTS'),
                },
              ],
            },
          ])
        }
      >
        Add section
      </Button>
      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
    </div>
  );
}
