import type { ConversationConfig, Provider, ProviderCatalog } from '@unleashd/shared';
import { useId } from 'react';
import { type ConfigGroup, type DefaultsDisplay, configGroups } from './config-options';
import './ConversationConfigPicker.css';

/** `choice`: a radio was picked. `typed`: a keystroke in the custom model field. */
export type ConfigEditOrigin = 'choice' | 'typed';

export interface ConversationConfigPickerProps {
  value: ConversationConfig;
  onChange: (config: ConversationConfig, origin: ConfigEditOrigin) => void;
  catalog: ProviderCatalog;
  disabled?: boolean;
  providerDisabled?: boolean;
  defaults?: DefaultsDisplay;
  providerFilter?: (provider: Provider) => boolean;
}

const ANY_PROVIDER = () => true;

const GROUP_CLASS: Record<ConfigGroup['id'], string> = {
  provider: 'config-picker__group config-picker__group--provider',
  model: 'config-picker__group',
  reasoning: 'config-picker__group',
};

/** Provider / model / reasoning radio groups. One list for every surface and device. */
export function ConversationConfigPicker({
  value,
  onChange,
  catalog,
  disabled = false,
  providerDisabled = false,
  defaults = 'listed',
  providerFilter = ANY_PROVIDER,
}: ConversationConfigPickerProps) {
  const id = useId().replace(/:/g, '');
  const groups = configGroups(value, catalog, defaults, providerFilter);
  const dynamicModels =
    catalog.providers.find((provider) => provider.id === value.provider)?.supportsDynamicModels ===
    true;

  return (
    <>
      {groups.map((group) => {
        const name = `${id}-${group.id}`;
        const locked = disabled || (group.id === 'provider' && providerDisabled);
        return (
          <div key={group.id} className="config-picker__section">
            <div className="config-picker__label" id={name}>
              {group.title}
            </div>
            <div className={GROUP_CLASS[group.id]} role="radiogroup" aria-labelledby={name}>
              {group.choices.map((choice) => (
                <label
                  key={choice.key}
                  className={`ui-choice config-picker__option ui-row ui-card${choice.selected ? ' selected' : ''}`}
                >
                  <input
                    type="radio"
                    name={name}
                    value={choice.key}
                    checked={choice.selected}
                    disabled={locked || choice.availability === 'unavailable'}
                    onChange={() => onChange(choice.next, 'choice')}
                  />
                  {choice.label}
                  {choice.meta && (
                    <span className="config-picker__meta ui-muted">{choice.meta}</span>
                  )}
                </label>
              ))}
              {group.id === 'model' && dynamicModels && (
                <label className="config-picker__custom">
                  <span>Custom model ID</span>
                  <input
                    type="text"
                    value={value.model.mode === 'explicit' ? value.model.modelId : ''}
                    disabled={disabled}
                    placeholder="provider/model"
                    spellCheck={false}
                    onChange={(event) => {
                      const modelId = event.target.value.trim();
                      onChange(
                        {
                          ...value,
                          model:
                            modelId.length > 0
                              ? { mode: 'explicit', modelId }
                              : { mode: 'default' },
                        },
                        'typed'
                      );
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
