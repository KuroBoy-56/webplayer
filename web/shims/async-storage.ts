// AsyncStorage sobre localStorage (el televisor lo guarda con la app; se borra al desinstalarla).
const ls = () => window.localStorage;

const AsyncStorage = {
  async getAllKeys(): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < ls().length; i++) out.push(ls().key(i)!);
    return out;
  },
  async multiGet(keys: string[]): Promise<[string, string | null][]> {
    return keys.map(k => [k, ls().getItem(k)]);
  },
  async getItem(k: string): Promise<string | null> {
    return ls().getItem(k);
  },
  async setItem(k: string, v: string): Promise<void> {
    ls().setItem(k, v);
  },
  async removeItem(k: string): Promise<void> {
    ls().removeItem(k);
  },
};

export default AsyncStorage;
