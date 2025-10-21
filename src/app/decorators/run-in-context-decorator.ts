import { Injector, runInInjectionContext } from '@angular/core';

interface InjectableWithInjector {
  injector: Injector;
}

export default function runInContext() {
  return function (
    target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      const injector = (this as InjectableWithInjector).injector;

      if (!injector) {
        throw new Error(
          `A classe '${target.constructor.name}' que usa o decorator @runInContext() deve ter uma propriedade pública 'injector' que seja uma instância do Injector. Ex: 'injector = inject(Injector);'`
        );
      }

      return runInInjectionContext(injector, () => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}