import { useId, useState } from 'react';
import type { SignInEntry } from '../lib/form';

export interface SignInRowProps {
  value: SignInEntry;
  onChange: (patch: Partial<SignInEntry>) => void;
  onRemove?: () => void;
  rolePlaceholder?: string;
  showRole?: boolean;
  roleLabel?: string;
  legend?: string;
}

const OPTIONAL = <span className="font-normal text-ink-soft">Optional</span>;

/**
 * One sign-in: role, username and password, and where the sign-in form is. The fields that name the form's
 * controls are shown on request (a button, not a nested disclosure), or by themselves once any is filled in.
 */
export function SignInRow({
  value,
  onChange,
  onRemove,
  rolePlaceholder = 'member',
  showRole = true,
  roleLabel = 'Role name',
  legend,
}: SignInRowProps) {
  const id = useId();
  const hasFieldNames = !!(value.usernameSelector?.trim() || value.passwordSelector?.trim() || value.submitSelector?.trim());
  const [showFields, setShowFields] = useState(hasFieldNames);
  const fieldsOpen = showFields || hasFieldNames;
  return (
    <fieldset className="grid gap-4 rounded-card border border-rule p-4 sm:grid-cols-2">
      {legend && <legend className="px-1 font-bold">{legend}</legend>}
      {showRole && (
        <label className="block">
          <span className="mb-1 block font-bold">{roleLabel}</span>
          <input
            className="field"
            value={value.role}
            placeholder={rolePlaceholder}
            onChange={(e) => onChange({ role: e.target.value })}
          />
        </label>
      )}
      <label className="block">
        <span className="mb-1 block font-bold">Email or username</span>
        <input
          className="field"
          autoComplete="off"
          value={value.username}
          onChange={(e) => onChange({ username: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="mb-1 block font-bold">Password</span>
        <input
          className="field"
          type="password"
          autoComplete="off"
          value={value.password}
          onChange={(e) => onChange({ password: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="mb-1 block font-bold">Sign-in page {OPTIONAL}</span>
        <span className="mb-1 block text-sm text-ink-soft">Where the sign-in form is, for example /login</span>
        <input
          className="field font-mono"
          value={value.loginPath}
          placeholder="/login"
          onChange={(e) => onChange({ loginPath: e.target.value })}
        />
      </label>
      <div className="col-span-full">
        {!hasFieldNames && (
          <button
            type="button"
            className="btn-link text-sm"
            aria-expanded={fieldsOpen}
            aria-controls={`${id}-fields`}
            onClick={() => setShowFields((s) => !s)}
          >
            {fieldsOpen ? 'Hide the form’s field names' : 'Name the form’s fields, for developers'}
          </button>
        )}
        {fieldsOpen && (
          <div id={`${id}-fields`} className="grid gap-4 pt-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block font-bold">Username field {OPTIONAL}</span>
              <input
                className="field font-mono text-sm"
                value={value.usernameSelector || ''}
                placeholder='input[name="user"]'
                onChange={(e) => onChange({ usernameSelector: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-bold">Password field {OPTIONAL}</span>
              <input
                className="field font-mono text-sm"
                value={value.passwordSelector || ''}
                placeholder='input[type="password"]'
                onChange={(e) => onChange({ passwordSelector: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-bold">Sign-in button {OPTIONAL}</span>
              <input
                className="field font-mono text-sm"
                value={value.submitSelector || ''}
                placeholder='button[type="submit"]'
                onChange={(e) => onChange({ submitSelector: e.target.value })}
              />
            </label>
          </div>
        )}
      </div>
      {onRemove && (
        <button type="button" className="btn-link justify-self-start text-sm" onClick={onRemove}>
          Remove this sign-in
        </button>
      )}
    </fieldset>
  );
}
