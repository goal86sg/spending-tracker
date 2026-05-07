// Quick test: manually test the PDF parser logic
const { parsePDFText } = require('./src/lib/pdf-parser.ts');

const sample = `
10 Feb    FAIRPRICE FINEST            $45.20
15 Feb    GRAB A7E2F SINGAPORE SG      $12.50
18 Feb  NETFLIX.COM SINGAPORE SG     $21.98
20 Feb    SP SERVICES                  $87.30
25 Feb    SHOPEE SINGAPORE SG          $34.90
01 Mar    KOPITIAM NORTHPOINT          $6.80
05 Mar    CIRCLE LINE SIMPLYGO         $1.20
CARD TRANSACTION SUMMARY
Balance Brought Forward: $1,200.00
Total Payments: $500.00
`;

console.log('Parsing sample text...');
const result = parsePDFText(sample, 'dbs-statement.pdf');
console.log('Found', result.length, 'transactions:');
result.forEach(t => {
  console.log(`  ${t.date} | ${t.description} | ${t.amount} | ${t.category}`);
});
