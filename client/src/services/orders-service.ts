import { ICreateOrder, IOrder } from '../types';

export async function listOrders(api: string): Promise<IOrder[]> {
  // list all of the orders
  const res = await fetch(`${api}/orders/`, {
    method: 'GET',
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  const orders: IOrder[] = await res.json();
  return orders;
}

export async function createOrder(
  api: string,
  order: ICreateOrder
): Promise<IOrder> {
  // create a new order
  const response = await fetch(`${api}/orders/`, {
    method: 'POST',
    mode: 'cors',
    body: JSON.stringify(order),
    headers: {
      'Content-Type': 'application/json',
    },
  });
  return (await response.json()) as IOrder;
}
