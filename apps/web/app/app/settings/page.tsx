import { CustomCssEditor } from '../../../components/integrations/CustomCssEditor';
import { StoreSettingsForm } from '../../../components/StoreSettingsForm';

export default function EmbeddedSettings() {
  return (
    <main>
      <h1>Settings</h1>
      <h2>Store</h2>
      <StoreSettingsForm />
      <h2>Custom CSS</h2>
      <CustomCssEditor />
    </main>
  );
}
