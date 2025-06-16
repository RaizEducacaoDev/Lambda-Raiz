import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import axios from 'axios';

export const handler: APIGatewayProxyHandler = async () => {
    try {
        const currentYear = new Date().getFullYear()
        const years = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i)
        const allDates: string[] = []

        for (const year of years) {
            try {
                const { data } = await axios.get<Array<{ date: string; counties: string[] | null; }>>(
                    `https://date.nager.at/api/v3/PublicHolidays/${year}/BR`
                )

                const nationalDates = data
                    .filter(h => h.counties === null)
                    .map(h => h.date)

                allDates.push(...nationalDates)
            } catch (error) {
                console.warn(`Erro ao buscar feriados de ${year}:`, error)
            }
        }

        console.log('[INFO] Dados encontrados na resposta.');
        return formatResponse(200, { message: 'Consulta realizada com sucesso.', data: allDates });

    } catch (error) {
        console.error('[ERROR] Erro ao consultar o serviço TOTVS:', error);
        return formatResponse(500, { message: 'Erro interno no servidor.', error: error instanceof Error ? error.message : String(error) });
    }
};