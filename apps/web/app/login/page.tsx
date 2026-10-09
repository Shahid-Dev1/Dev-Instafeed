import Link from 'next/link';
import { AuthForm } from '../../components/AuthForm';

export default function LoginPage() {
  return (
    <main>
      <h1>Log in</h1>
      <AuthForm mode="login" />
      <p>New here? <Link href="/register">Create an account</Link></p>
    </main>
  );
}
