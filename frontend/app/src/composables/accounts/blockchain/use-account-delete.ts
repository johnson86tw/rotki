import { Blockchain } from '@rotki/common/lib/blockchain';
import type { Account } from '@rotki/common/lib/account';
import type {
  BlockchainAccountBalance,
  DeleteXpubParams,
  EthereumValidator,
} from '@/types/blockchain/accounts';

export function useAccountDelete() {
  const { deleteEth2Validators } = useEthStaking();
  const { removeAccount, removeAgnosticAccount, deleteXpub } = useBlockchainAccounts();
  const { refreshAccounts } = useBlockchains();
  const { t } = useI18n();
  const { show } = useConfirmStore();

  async function deleteValidators(payload: EthereumValidator[]): Promise<void> {
    await deleteEth2Validators(payload.map(validator => validator.publicKey));
  }

  async function deleteAccount(payload: BlockchainAccountBalance[]): Promise<void> {
    if (payload.length === 0)
      return;

    const validators: string[] = [];
    const chainAccounts: Account[] = [];
    const xpubs: DeleteXpubParams[] = [];

    payload.forEach((account): void => {
      if (account.data.type === 'validator') {
        validators.push(account.data.publicKey);
      }
      else if (account.data.type === 'xpub') {
        const chain = getChain(account);
        assert(chain);
        xpubs.push({
          xpub: account.data.xpub,
          derivationPath: account.data.derivationPath,
          chain,
        });
      }
      else {
        if (account.type === 'account') {
          if (!account.virtual) {
            chainAccounts.push({
              address: account.data.address,
              chain: account.chain,
            });
          }
        }
        else {
          for (const chain of account.chains) {
            chainAccounts.push({
              address: account.data.address,
              chain,
            });
          }
        }
      }
    });

    const chainsToRefresh = [];
    if (validators.length > 0) {
      await deleteEth2Validators(validators);
      chainsToRefresh.push(Blockchain.ETH2);
    }

    if (chainAccounts.length > 0) {
      const deletion = chainAccounts.reduce(
        (previousValue, currentValue) => {
          if (!previousValue[currentValue.chain])
            previousValue[currentValue.chain] = [currentValue.address];
          else previousValue[currentValue.chain].push(currentValue.address);
          return previousValue;
        },
        {} as Record<string, string[]>,
      );
      for (const [chain, accounts] of Object.entries(deletion)) {
        chainsToRefresh.push(chain);
        await removeAccount({
          accounts,
          chain,
        });
      }
    }

    if (xpubs.length > 0)
      for (const xpub of xpubs) await deleteXpub(xpub);

    const chains = payload.flatMap(x => x.type === 'group' ? x.chains : x.chain);
    startPromise(refreshAccounts(chains.length === 1 ? chains[0] : undefined));
  }

  function showConfirmation(payload: {
    type: 'accounts';
    data: BlockchainAccountBalance[];
  } | {
    type: 'validators';
    data: EthereumValidator[];
  }, onComplete?: () => void) {
    const message: string = Array.isArray(payload.data)
      ? t('account_balances.confirm_delete.description_address', {
        count: payload.data.length,
      })
      : t('account_balances.confirm_delete.description_xpub', {
        address: payload,
      });
    show(
      {
        title: t('account_balances.confirm_delete.title'),
        message,
      },
      async () => {
        if (payload.type === 'accounts')
          await deleteAccount(payload.data);
        else
          await deleteValidators(payload.data);

        onComplete?.();
      },
    );
  }

  async function deleteAgnosticAccount(payload: BlockchainAccountBalance): Promise<void> {
    const category = payload.category;
    if (category) {
      const address = getAccountAddress(payload);
      await removeAgnosticAccount(category, address);
      startPromise(refreshAccounts());
    }
  }

  function showAgnosticConfirmation(payload: BlockchainAccountBalance, onComplete?: () => void) {
    const message: string = t('account_balances.confirm_delete.agnostic.description', {
      address: getAccountAddress(payload),
    });
    show({
      title: t('account_balances.confirm_delete.title'),
      message,
    }, async () => {
      await deleteAgnosticAccount(payload);
      onComplete?.();
    });
  }

  return {
    showConfirmation,
    showAgnosticConfirmation,
  };
}
