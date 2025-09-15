import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.tsx";
import { createNetworkConfig, SuiClientProvider, WalletProvider } from '@mysten/dapp-kit';
import { getFullnodeUrl} from '@mysten/sui/client';
import '@mysten/dapp-kit/dist/index.css';


const { networkConfig } = createNetworkConfig({
	testnet: { url: getFullnodeUrl('testnet') },

});

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>

      <QueryClientProvider client={queryClient}>
        <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
          <WalletProvider autoConnect>
            <App />
          </WalletProvider>
        </SuiClientProvider>
      </QueryClientProvider>

  </StrictMode>,
);