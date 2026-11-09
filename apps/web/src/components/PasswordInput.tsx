import { useState, type InputHTMLAttributes } from 'react'

/** Password box with a show/hide button so people can check what they typed. */
export function PasswordInput({ className = 'ps-input', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false)
  return (
    <div className="password-input">
      <input {...props} type={shown ? 'text' : 'password'} className={className} />
      <button
        type="button"
        className="password-input-toggle"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        tabIndex={0}
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
