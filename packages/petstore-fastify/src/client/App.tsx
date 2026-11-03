import { useState, type FormEvent } from 'react'
import { useContact, useLogin } from '../../generated-auth/hooks.js'
import { setToken } from './token.js'

type ContactMethod = 'email' | 'phone'
type FieldErrors = { email?: string; phone?: string }
type ZodIssue = { path: (string | number)[]; message: string }

// Place a message on the email or phone slot; ignore any other field.
function assignField(errors: FieldErrors, field: unknown, message: string): FieldErrors {
  if (field === 'email') return { ...errors, email: message }
  if (field === 'phone') return { ...errors, phone: message }
  return errors
}

function isZodLike(error: unknown): error is { issues: ZodIssue[] } {
  return (
    error != null &&
    typeof error === 'object' &&
    'issues' in error &&
    Array.isArray((error as { issues: unknown }).issues)
  )
}

// The generated client runs ContactRequestSchema.parse(body) before the request, so a
// cross-field failure throws a ZodError with path-tagged issues client-side. This proves
// the shared schema round-trips onto the form before any network call. (The server-side
// 400 path is covered by the inject tests in auth-routes.test.ts.)
function parseContactErrors(error: unknown): FieldErrors {
  if (!isZodLike(error)) return {}
  return error.issues.reduce((acc, issue) => assignField(acc, issue.path[0], issue.message), {})
}

function Field({
  testid,
  placeholder,
  value,
  onChange,
  error,
  type,
}: {
  testid: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  error?: string
  type?: string
}) {
  return (
    <div>
      <input
        data-testid={testid}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <span data-testid={`${testid}-error`}>{error}</span>}
    </div>
  )
}

function LoginView({ onSuccess }: { onSuccess: (t: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const login = useLogin({
    onSuccess: (data) => onSuccess(data.token),
    onError: () => setError('Login failed. Check your credentials.'),
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    login.mutate({ username: username.trim(), password: password.trim() })
  }

  return (
    <main>
      <h1>Auth Lab: Login</h1>
      <form onSubmit={handleSubmit}>
        <Field
          testid="login-username"
          placeholder="Username"
          value={username}
          onChange={setUsername}
        />
        <Field
          testid="login-password"
          type="password"
          placeholder="Password"
          value={password}
          onChange={setPassword}
        />
        {error && <p data-testid="login-error">{error}</p>}
        <button data-testid="login-submit" type="submit" disabled={login.isPending}>
          {login.isPending ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </main>
  )
}

function ContactView() {
  const [method, setMethod] = useState<ContactMethod>('email')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [success, setSuccess] = useState(false)

  const contact = useContact({
    onSuccess: () => {
      setSuccess(true)
      setFieldErrors({})
    },
    onError: (error) => setFieldErrors(parseContactErrors(error)),
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setFieldErrors({})
    setSuccess(false)
    contact.mutate({
      method,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      message: message.trim(),
    })
  }

  return (
    <main>
      <h1>Auth Lab: Contact</h1>
      {success ? (
        <p data-testid="contact-success">Contact request accepted.</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <div>
            <label htmlFor="contact-method">Contact method</label>
            <select
              id="contact-method"
              data-testid="contact-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as ContactMethod)}
            >
              <option value="email">Email</option>
              <option value="phone">Phone</option>
            </select>
          </div>
          <Field
            testid="contact-email"
            placeholder="Email"
            value={email}
            onChange={setEmail}
            error={fieldErrors.email}
          />
          <Field
            testid="contact-phone"
            placeholder="Phone"
            value={phone}
            onChange={setPhone}
            error={fieldErrors.phone}
          />
          <Field
            testid="contact-message"
            placeholder="Message"
            value={message}
            onChange={setMessage}
          />
          <button data-testid="contact-submit" type="submit" disabled={contact.isPending}>
            {contact.isPending ? 'Sending...' : 'Send'}
          </button>
        </form>
      )}
    </main>
  )
}

export function App() {
  const [loggedIn, setLoggedIn] = useState(false)

  const handleLoginSuccess = (t: string) => {
    setToken(t)
    setLoggedIn(true)
  }

  return loggedIn ? <ContactView /> : <LoginView onSuccess={handleLoginSuccess} />
}
