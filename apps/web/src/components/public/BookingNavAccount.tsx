import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { usePatientStore } from '@pharmstation/core'

// The account link in the booking and shop headers: "Sign in" for visitors,
// "My appointments" once a patient is signed in to the portal.
export function BookingNavAccount() {
  const { isLoggedIn, loading, initialize } = usePatientStore()
  useEffect(() => {
    if (loading) initialize()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return isLoggedIn
    ? <Link to="/patient/appointments">My appointments</Link>
    : <a href="/patient/login">Sign in</a>
}
